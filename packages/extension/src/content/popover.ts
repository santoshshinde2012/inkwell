// In-page popover. Vanilla DOM (no React) so the in-content bundle stays
// small. Mounted inside the closed Shadow DOM the trigger created.
//
// UX principles enforced here:
//   • Works on a field OR a selection OR typed-in text (see PopoverSource).
//   • Persistent DOM. We never blow away innerHTML on state changes — that
//     would steal focus from the textarea mid-typing. Instead we cache
//     element refs and mutate the smallest subtree that changed.
//   • Keyboard-first. Esc closes; Cmd/Ctrl+Enter generates, then inserts
//     (field) or copies (selection); outside-click also dismisses.
//   • Streaming feedback. While tokens arrive, a pulsing caret follows the
//     last character so the user sees progress at a glance.
//   • Output handling. In field mode the result can be inserted ("Reply"
//     at the cursor; Grammar/Rewrite replace the field) — and copied. In
//     selection / blank mode it is copy-only: we never write to the page.
//   • Accessible. role="dialog" + aria-labelledby + aria-live="polite" on
//     the streaming preview. Non-modal (aria-modal="false") — initial focus
//     lands on the primary input, and focus returns to the source field on
//     a successful insert. Esc closes; Cmd/Ctrl+Enter generates.
//   • Dark-mode aware via prefers-color-scheme.

import {
  Action,
  RequestContext,
  TonePreset,
  TONE_PRESETS,
  TONE_PRESET_LABELS,
  ModelId,
  MODEL_CATALOG,
  DEFAULT_MODEL_ID,
  MESSAGE_TYPES,
  CompleteStartMessage,
  CompleteCancelMessage,
  CompleteTokenMessage,
  CompleteDoneMessage,
  CompleteErrorMessage,
  CompleteUsageMessage,
  LanguageId,
  SourceLanguage,
  LANGUAGE_CATALOG,
  DEFAULT_WORKING_LANGUAGE,
  getLanguageInfo,
  isLanguageId,
  languageDisplayName,
  languageLabel,
} from "@inkwell/shared";
import { sendToBackground } from "../lib/messaging";
import { localStore } from "../lib/storage";
import { detectLanguage } from "../lib/languages";
import { historyStore, type NewHistoryEntry } from "../lib/history";
import { readText, writeText } from "./editable";
import type { SiteAdapter } from "./adapters";

import {
  loadOptsExpanded,
  saveOptsExpanded,
  loadLastUsed,
  saveLastUsed,
  isValidAction,
  isValidTone,
  isValidModel,
  isValidSourceLang,
  isValidTargetChoice,
  type TargetChoice,
} from "../lib/ui-state";

// Where the text Inkwell works on comes from. This is what makes the
// popover usable both inside editable fields AND on read-only page text:
//
//   field     — an editable element. The result can be inserted back.
//   selection — text the user highlighted anywhere on the page. Read-only,
//               so the result is copy-only (we never write to the page).
//   blank     — opened with nothing focused/selected; the user types the
//               text into the popover themselves.
export type PopoverSource =
  | { kind: "field"; element: HTMLElement }
  | { kind: "selection"; text: string }
  | { kind: "blank" };

interface MountArgs {
  shadow: ShadowRoot;
  /** Viewport rect the popover positions itself against. */
  anchorRect: DOMRect;
  source: PopoverSource;
  adapter: SiteAdapter;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Lucide-style SVG icons (MIT, https://lucide.dev). Inlined as strings so
// they ship inside the same bundle and don't need any extra fetch.
// ---------------------------------------------------------------------------

const SVG_ATTRS =
  'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

const ICON_REPLY = `<svg ${SVG_ATTRS}><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>`;
const ICON_GRAMMAR = `<svg ${SVG_ATTRS}><path d="m6 16 6-12 6 12"/><path d="M8 12h8"/><path d="m16 20 2 2 4-4"/></svg>`;
const ICON_REWRITE = `<svg ${SVG_ATTRS}><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`;
// The Inkwell brand mark — a filled ink drop. Matches icons/logo.svg.
const ICON_DROP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.88C13.13 6.94 16.13 9 16.13 11.44A5.25 5.25 0 1 1 7.88 11.44C7.88 9 10.88 6.94 12 4.88Z"/></svg>`;
const ICON_X = `<svg ${SVG_ATTRS}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
const ICON_CHECK = `<svg ${SVG_ATTRS}><path d="M20 6 9 17l-5-5"/></svg>`;
const ICON_REFRESH = `<svg ${SVG_ATTRS}><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>`;
const ICON_SQUARE = `<svg ${SVG_ATTRS}><rect width="14" height="14" x="5" y="5" rx="1.5"/></svg>`;
const ICON_ARROW_RIGHT = `<svg ${SVG_ATTRS}><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`;
const ICON_CHEVRON_DOWN = `<svg ${SVG_ATTRS}><path d="m6 9 6 6 6-6"/></svg>`;
// Lucide "sliders-horizontal" — signifies "settings / adjust" in the
// Options disclosure. Reads instantly even at 14px.
const ICON_SLIDERS = `<svg ${SVG_ATTRS}><line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><circle cx="14" cy="4" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="16" cy="20" r="2"/></svg>`;
const ICON_COPY = `<svg ${SVG_ATTRS}><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
const ICON_TRANSLATE = `<svg ${SVG_ATTRS}><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const ACTION_LABELS: Record<Action, string> = {
  reply: "Reply",
  translate: "Translate",
  grammar: "Grammar",
  rewrite: "Rewrite",
};

const ACTION_ICONS: Record<Action, string> = {
  reply: ICON_REPLY,
  translate: ICON_TRANSLATE,
  grammar: ICON_GRAMMAR,
  rewrite: ICON_REWRITE,
};

const ACTION_HINTS: Record<Action, string> = {
  reply: "Drafts a contextual reply — in the customer's language, yours, or both.",
  translate:
    "Translates the text into the language you choose. The original is kept in history.",
  grammar: "Fixes grammar and spelling in the text's own language — no translation.",
  rewrite:
    "Rewrites for tone, length, or clarity — optionally into another language.",
};

const INSTRUCTION_PLACEHOLDERS: Record<Action, string> = {
  reply: "Optional: how to shape the reply (e.g. “agree, propose Friday 2pm”).",
  translate:
    "Optional: extra direction (e.g. “this is a support ticket — keep it formal”).",
  grammar: "Optional: extra direction (e.g. “keep the casual tone”).",
  rewrite:
    "Describe what to write, or how to rewrite the text. No text? Then this is your brief.",
};

// Label + placeholder for the "your text" box, by action. Shown only in
// selection / blank mode (in field mode the text is read from the field).
const SOURCE_LABELS: Record<Action, string> = {
  reply: "Text to reply to",
  translate: "Text to translate",
  grammar: "Text to fix",
  rewrite: "Text to rewrite",
};
const SOURCE_PLACEHOLDERS: Record<Action, string> = {
  reply: "Paste or type the message you're replying to…",
  translate: "Paste or type the customer's message to translate…",
  grammar: "Paste or type the text whose grammar you want fixed…",
  rewrite:
    "Paste or type the text to rewrite (or leave blank and add a brief in Options)…",
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const POPOVER_STYLES = `
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; }

  @keyframes inkwell-pop-in {
    from { opacity: 0; transform: translateY(6px) scale(0.985); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes inkwell-caret {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0; }
  }
  @keyframes inkwell-spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
  @keyframes inkwell-thinking {
    0%, 80%, 100% { opacity: .25; transform: translateY(0); }
    40%           { opacity: 1;   transform: translateY(-3px); }
  }
  @keyframes inkwell-fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .pop {
    /* One modern, professional UI font for the whole popover. Every control
       below pulls from this variable so nothing silently falls back to a UA
       default — an unstyled <textarea>, for one, renders in monospace. */
    --inkwell-font: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
      Roboto, "Helvetica Neue", Arial, sans-serif;
    pointer-events: auto;
    position: fixed;
    width: 420px;
    max-width: calc(100vw - 16px);
    max-height: min(620px, calc(100vh - 32px));
    display: flex;
    flex-direction: column;
    background: #ffffff;
    color: #18181b;
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 16px;
    box-shadow:
      0 2px 6px rgba(0, 0, 0, 0.06),
      0 12px 32px -4px rgba(0, 0, 0, 0.16),
      0 24px 56px -12px rgba(0, 0, 0, 0.22);
    overflow: hidden;
    font-family: var(--inkwell-font);
    font-size: 13px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeLegibility;
    caret-color: #6366f1;
    animation: inkwell-pop-in 160ms cubic-bezier(.2,.8,.2,1) both;
  }
  .pop:focus { outline: none; }
  .pop ::selection { background: rgba(99, 102, 241, 0.22); }

  /* Header ----------------------------------------------------- */
  .head {
    display: flex; align-items: center; gap: 9px;
    padding: 11px 14px;
    border-bottom: 1px solid #ececef;
  }
  .brand-icon {
    width: 24px; height: 24px;
    display: inline-flex; align-items: center; justify-content: center;
    border-radius: 7px;
    background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
    color: #fff;
    flex-shrink: 0;
  }
  .brand-icon svg { width: 14px; height: 14px; }
  .title {
    font-size: 13px; font-weight: 650; color: #0f172a;
    letter-spacing: -0.01em;
  }
  .title-sub {
    font-size: 11px; color: #71717a; font-weight: 400; margin-top: 1px;
  }
  .head-spacer { flex: 1; }
  .icon-btn {
    appearance: none; background: transparent; border: 0;
    width: 28px; height: 28px;
    display: inline-flex; align-items: center; justify-content: center;
    border-radius: 6px; color: #64748b; cursor: pointer;
    transition: background 120ms, color 120ms;
  }
  .icon-btn:hover { background: #f1f5f9; color: #0f172a; }
  .icon-btn:focus-visible { outline: 2px solid #6366f1; outline-offset: 1px; }
  .icon-btn svg { width: 14px; height: 14px; }

  /* Body ------------------------------------------------------- */
  .body {
    padding: 12px 14px;
    overflow: auto;
  }

  /* Action segmented control */
  .actions {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px;
    padding: 4px;
    background: #f4f4f5; border-radius: 10px;
    margin-bottom: 12px;
  }
  .action {
    appearance: none; border: 0;
    display: inline-flex; align-items: center; justify-content: center;
    gap: 5px;
    padding: 7px 4px; border-radius: 7px;
    background: transparent; color: #52525b;
    font-family: var(--inkwell-font);
    font-size: 11.5px; font-weight: 500; line-height: 1;
    white-space: nowrap; overflow: hidden;
    cursor: pointer;
    transition: background 120ms, color 120ms, box-shadow 120ms;
  }
  .action:hover { color: #18181b; }
  .action[aria-selected="true"] {
    background: #ffffff; color: #4f46e5;
    box-shadow:
      0 1px 3px rgba(0,0,0,0.10),
      0 0 0 1px rgba(0,0,0,0.03);
  }
  .action svg { width: 13px; height: 13px; }
  .action:focus-visible { outline: 2px solid #6366f1; outline-offset: 1px; }

  .action-hint {
    margin: 2px 2px 4px; font-size: 11px; color: #71717a; line-height: 1.45;
  }

  /* "Your text" box — shown for selection / manual-entry mode */
  .source-wrap { display: flex; flex-direction: column; gap: 5px; margin-bottom: 10px; }
  .source {
    width: 100%; min-height: 70px; max-height: 180px;
    padding: 8px 10px;
    border: 1px solid #e4e4e7; border-radius: 8px;
    background: #ffffff; color: #18181b;
    font-family: var(--inkwell-font);
    font-size: 13px; line-height: 1.45;
    resize: vertical;
    transition: border-color 120ms, box-shadow 120ms;
  }
  .source:focus {
    outline: none; border-color: #6366f1;
    box-shadow: 0 0 0 3px rgba(99,102,241,.18);
  }
  .source::placeholder { color: #a1a1aa; }

  /* Options disclosure — collapses language + tone/model + instruction so
     the popover's primary surface is text in → result out. The whole
     disclosure is one bordered card; the toggle is its borderless header,
     and the body slides open inside the same frame. A grid-template-rows
     0fr → 1fr animation gives a smooth, content-aware expand without any
     hard-coded max-height. */
  .opts {
    margin-bottom: 10px;
    border: 1px solid #e4e4e7; border-radius: 10px;
    background: #ffffff;
    transition: border-color 160ms;
  }
  .opts:hover { border-color: #d4d4d8; }
  .opts-toggle {
    appearance: none;
    width: 100%;
    display: flex; align-items: center; gap: 9px;
    padding: 10px 12px;
    background: transparent; border: 0; border-radius: 10px;
    color: #52525b; cursor: pointer;
    font-family: var(--inkwell-font);
    font-size: 12px; font-weight: 500; line-height: 1.3;
    text-align: left;
    transition: color 120ms;
  }
  .opts-toggle:hover { color: #18181b; }
  .opts-toggle:focus-visible {
    outline: 2px solid #6366f1; outline-offset: -2px;
  }
  .opts-icon, .opts-chevron {
    display: inline-flex; align-items: center;
    color: #a1a1aa; flex-shrink: 0;
    transition: color 120ms;
  }
  .opts-icon svg, .opts-chevron svg { width: 14px; height: 14px; }
  .opts-toggle:hover .opts-icon,
  .opts-toggle:hover .opts-chevron { color: #71717a; }
  .opts-text {
    flex: 1; min-width: 0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .opts-chevron {
    transition: transform 260ms cubic-bezier(.4,0,.2,1), color 120ms;
  }
  .opts-toggle[aria-expanded="true"] .opts-chevron { transform: rotate(180deg); }

  .opts-body {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 260ms cubic-bezier(.4,0,.2,1);
  }
  .opts-toggle[aria-expanded="true"] + .opts-body {
    grid-template-rows: 1fr;
  }
  .opts-inner {
    min-height: 0; overflow: hidden;
    padding: 12px 12px 2px;
    border-top: 1px solid transparent;
    transition: border-top-color 200ms;
  }
  .opts-toggle[aria-expanded="true"] + .opts-body .opts-inner {
    border-top-color: #ececef;
  }
  /* The wrapped rows already provide their own bottom margin — drop the
     final margin so the card closes flush. */
  .opts-inner > :last-child { margin-bottom: 0; }

  /* Control rows — the language pair and the tone/model settings.
     Every configuration control uses the same .lang-field + .lang-select. */
  .lang-row {
    display: flex; align-items: flex-end; gap: 8px;
    margin-bottom: 10px;
  }
  .lang-field {
    display: flex; flex-direction: column; gap: 5px;
    flex: 1; min-width: 0;
  }
  .lang-field-label {
    font-size: 10px; font-weight: 600; color: #71717a;
    text-transform: uppercase; letter-spacing: .045em;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .lang-detected {
    color: #6366f1; text-transform: none; letter-spacing: 0;
  }
  .lang-select {
    width: 100%; min-width: 0;
    appearance: none;
    border: 1px solid #e4e4e7; border-radius: 8px;
    background-color: #ffffff; color: #18181b;
    padding: 8px 28px 8px 10px;
    font-family: var(--inkwell-font);
    font-size: 12.5px; font-weight: 500; line-height: 1.3;
    cursor: pointer;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888890' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>");
    background-repeat: no-repeat;
    background-position: right 9px center;
    transition: border-color 120ms, box-shadow 120ms;
  }
  .lang-select:hover { border-color: #a1a1aa; }
  .lang-select:focus-visible {
    outline: none; border-color: #6366f1;
    box-shadow: 0 0 0 3px rgba(99,102,241,.18);
  }
  .lang-select:disabled { opacity: .55; cursor: not-allowed; }
  .lang-arrow {
    color: #a1a1aa; flex-shrink: 0;
    display: inline-flex; align-items: center;
    padding-bottom: 9px;
  }
  .lang-arrow svg { width: 14px; height: 14px; }

  /* Instruction textarea */
  .instruction-wrap { position: relative; }
  .instruction {
    width: 100%; min-height: 60px; max-height: 140px;
    padding: 8px 10px;
    border: 1px solid #e4e4e7; border-radius: 8px;
    background: #ffffff; color: #18181b;
    font-family: var(--inkwell-font);
    font-size: 13px; line-height: 1.45;
    resize: vertical;
    transition: border-color 120ms, box-shadow 120ms;
  }
  .instruction:focus {
    outline: none;
    border-color: #6366f1;
    box-shadow: 0 0 0 3px rgba(99,102,241,.18);
  }
  .instruction::placeholder { color: #a1a1aa; }
  .char-count {
    position: absolute; right: 8px; bottom: 6px;
    font-size: 10px; color: #a1a1aa; pointer-events: none;
    background: rgba(255,255,255,0.85); padding: 0 4px; border-radius: 4px;
  }
  .char-count.warn { color: #ea580c; }
  .char-count.over { color: #dc2626; }

  /* Preview */
  .preview-wrap {
    margin-top: 12px; padding: 12px;
    background: #fafafa;
    border: 1px solid #e4e4e7; border-radius: 10px;
    min-height: 78px;
    max-height: 240px; overflow: auto;
    position: relative;
    transition: background 120ms, border-color 120ms;
  }
  .preview-wrap[data-state="empty"] { background: transparent; border-style: dashed; }
  .preview-wrap[data-state="streaming"] { border-color: #c7d2fe; background: #f6f5ff; }
  .preview-wrap[data-state="error"] { border-color: #fecaca; background: #fef2f2; }
  .preview {
    color: #18181b;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--inkwell-font);
    font-size: 13px; line-height: 1.6;
  }
  .preview-empty { color: #a1a1aa; }
  .caret::after {
    content: "";
    display: inline-block; width: 1px; height: 1.05em;
    background: #6366f1; vertical-align: -2px; margin-left: 1px;
    animation: inkwell-caret 1s steps(1) infinite;
  }

  /* Pre-token "thinking" state — an animated indicator instead of dead text. */
  .thinking {
    display: inline-flex; align-items: center; gap: 7px;
    color: #71717a;
  }
  .thinking-dots { display: inline-flex; gap: 4px; }
  .thinking-dots i {
    display: block; width: 5px; height: 5px;
    border-radius: 50%; background: #6366f1;
    animation: inkwell-thinking 1.1s ease-in-out infinite;
  }
  .thinking-dots i:nth-child(2) { animation-delay: .15s; }
  .thinking-dots i:nth-child(3) { animation-delay: .30s; }

  .err {
    margin-top: 8px;
    font-size: 12px; color: #b91c1c; display: flex; gap: 6px; align-items: flex-start;
  }
  .err svg { flex-shrink: 0; width: 14px; height: 14px; margin-top: 1px; }

  /* Footer ----------------------------------------------------- */
  .footer {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 14px;
    border-top: 1px solid #f1f5f9;
    background: #fafafa;
  }
  .meta {
    flex: 1; font-size: 11px; color: #a1a1aa; min-width: 0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .kbd {
    display: inline-flex; align-items: center; gap: 1px;
    font: 500 10px/1 ui-monospace, "SF Mono", Menlo, monospace;
    color: #71717a;
    background: #ffffff;
    border: 1px solid #e4e4e7; border-radius: 4px;
    padding: 2px 4px;
    margin-left: 4px;
  }
  .btn {
    appearance: none; border: 0; cursor: pointer;
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 12px; border-radius: 8px;
    font-family: var(--inkwell-font);
    font-size: 13px; font-weight: 500; line-height: 1;
    transition: background 120ms, color 120ms, transform 80ms, box-shadow 120ms;
  }
  .btn:focus-visible { outline: 2px solid #6366f1; outline-offset: 1px; }
  .btn:active { transform: translateY(0.5px); }
  .btn[disabled] { opacity: 0.5; cursor: not-allowed; transform: none; }
  .btn svg { width: 14px; height: 14px; }
  .btn-primary {
    background: #18181b; color: #ffffff;
  }
  .btn-primary:hover:not([disabled]) { background: #000000; }
  .btn-primary.accent {
    background: #6366f1;
  }
  .btn-primary.accent:hover:not([disabled]) { background: #4f46e5; }
  .btn-secondary {
    background: #ffffff; color: #18181b; border: 1px solid #e4e4e7;
  }
  .btn-secondary:hover:not([disabled]) {
    background: #f4f4f5; border-color: #d4d4d8;
  }

  .spin svg { animation: inkwell-spin 0.9s linear infinite; }

  /* Slim, unobtrusive scrollbars on every scrollable region — the chunky
     OS default scrollbar reads as unpolished inside a compact popover. */
  .body, .preview-wrap, .source, .instruction {
    scrollbar-width: thin;
    scrollbar-color: rgba(0, 0, 0, 0.22) transparent;
  }
  .body::-webkit-scrollbar,
  .preview-wrap::-webkit-scrollbar,
  .source::-webkit-scrollbar,
  .instruction::-webkit-scrollbar { width: 10px; height: 10px; }
  .body::-webkit-scrollbar-thumb,
  .preview-wrap::-webkit-scrollbar-thumb,
  .source::-webkit-scrollbar-thumb,
  .instruction::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.20);
    border: 3px solid transparent;
    border-radius: 9999px;
    background-clip: padding-box;
  }
  .body::-webkit-scrollbar-thumb:hover,
  .preview-wrap::-webkit-scrollbar-thumb:hover,
  .source::-webkit-scrollbar-thumb:hover,
  .instruction::-webkit-scrollbar-thumb:hover {
    background: rgba(0, 0, 0, 0.34);
    background-clip: padding-box;
  }
  .body::-webkit-scrollbar-track,
  .preview-wrap::-webkit-scrollbar-track,
  .source::-webkit-scrollbar-track,
  .instruction::-webkit-scrollbar-track { background: transparent; }

  /* Dark mode ---------------------------------------------- */
  @media (prefers-color-scheme: dark) {
    .pop {
      background: #18181b; color: #f4f4f5;
      border-color: rgba(255,255,255,0.08);
      box-shadow:
        0 2px 6px rgba(0,0,0,0.5),
        0 12px 32px -4px rgba(0,0,0,0.55),
        0 24px 56px -12px rgba(0,0,0,0.7);
    }
    .head { border-color:#27272a; }
    .title { color:#f4f4f5; } .title-sub { color:#a1a1aa; }
    .icon-btn { color:#a1a1aa; } .icon-btn:hover { background:#27272a; color:#f4f4f5; }
    .actions { background:#27272a; }
    .action { color:#a1a1aa; }
    .action:hover { color:#f4f4f5; }
    .action[aria-selected="true"] {
      background:#3f3f46; color:#c7d2fe;
      box-shadow: 0 1px 2px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05);
    }
    .action-hint { color: #a1a1aa; }
    .source { background:#1c1c1f; border-color:#3f3f46; color:#f4f4f5; }
    .source:focus { border-color:#818cf8; box-shadow: 0 0 0 3px rgba(129,140,248,.22); }
    .source::placeholder { color:#71717a; }
    .lang-field-label { color:#a1a1aa; }
    .lang-detected { color:#a5b4fc; }
    .lang-select { background-color:#1c1c1f; border-color:#3f3f46; color:#f4f4f5; }
    .lang-select:hover { border-color:#52525b; }
    .lang-select:focus-visible { border-color:#818cf8; box-shadow: 0 0 0 3px rgba(129,140,248,.22); }
    .lang-arrow { color:#52525b; }
    .instruction { background:#1c1c1f; border-color:#3f3f46; color:#f4f4f5; }
    .instruction:focus { border-color:#818cf8; box-shadow: 0 0 0 3px rgba(129,140,248,.22); }
    .instruction::placeholder { color:#71717a; }
    .char-count { background: rgba(24,24,27,0.85); color:#71717a; }
    .preview-wrap { background:#1f1f23; border-color:#3f3f46; }
    .preview-wrap[data-state="empty"] { background: transparent; }
    .preview-wrap[data-state="streaming"] { border-color:#4338ca; background:#1e1b35; }
    .preview-wrap[data-state="error"] { border-color:#7f1d1d; background:#1c0f10; }
    .preview { color:#f4f4f5; }
    .preview-empty { color:#71717a; }
    .err { color:#fca5a5; }
    .footer { background:#1c1c1f; border-color:#27272a; }
    .meta { color:#71717a; }
    .kbd { background:#27272a; border-color:#3f3f46; color:#a1a1aa; }
    .btn-primary { background:#f4f4f5; color:#18181b; }
    .btn-primary:hover:not([disabled]) { background:#ffffff; }
    .btn-primary.accent { background:#818cf8; color:#0a0a0a; }
    .btn-primary.accent:hover:not([disabled]) { background:#a5b4fc; }
    .btn-secondary { background:#27272a; color:#f4f4f5; border-color:#3f3f46; }
    .btn-secondary:hover:not([disabled]) { background:#3f3f46; border-color:#52525b; }
    .pop { caret-color:#818cf8; }
    .pop ::selection { background: rgba(129,140,248,0.32); }
    .thinking { color:#a1a1aa; }
    .thinking-dots i { background:#818cf8; }
    .body, .preview-wrap, .source, .instruction {
      scrollbar-color: rgba(255,255,255,0.22) transparent;
    }
    .body::-webkit-scrollbar-thumb,
    .preview-wrap::-webkit-scrollbar-thumb,
    .source::-webkit-scrollbar-thumb,
    .instruction::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.18); }
    .body::-webkit-scrollbar-thumb:hover,
    .preview-wrap::-webkit-scrollbar-thumb:hover,
    .source::-webkit-scrollbar-thumb:hover,
    .instruction::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.30); }
    .opts { background:#1a1a1d; border-color:#3f3f46; }
    .opts:hover { border-color:#52525b; }
    .opts-toggle { color:#a1a1aa; }
    .opts-toggle:hover { color:#f4f4f5; }
    .opts-icon, .opts-chevron { color:#71717a; }
    .opts-toggle:hover .opts-icon,
    .opts-toggle:hover .opts-chevron { color:#a1a1aa; }
    .opts-toggle[aria-expanded="true"] + .opts-body .opts-inner {
      border-top-color:#27272a;
    }
  }

  /* Reduced motion */
  @media (prefers-reduced-motion: reduce) {
    .pop { animation: none; }
    .caret::after { animation: none; opacity: 1; }
    .spin svg { animation: none; }
    .thinking-dots i { animation: none; opacity: 1; }
    .opts-body, .opts-chevron { transition: none; }
  }
`;

// ---------------------------------------------------------------------------
// Positioning. Tries below the field; flips above if there's more room there.
// Stays inside the viewport with an 8px margin on every side.
// ---------------------------------------------------------------------------

const positionPopover = (el: HTMLElement, rect: DOMRect): void => {
  const margin = 8;
  const popH = el.offsetHeight || 360;
  const popW = el.offsetWidth || 420;
  const spaceBelow = window.innerHeight - rect.bottom - margin;
  const spaceAbove = rect.top - margin;

  let top: number;
  if (spaceBelow >= popH + margin || spaceBelow >= spaceAbove) {
    top = Math.max(margin, rect.bottom + 8);
  } else {
    top = Math.max(margin, rect.top - popH - 8);
  }

  let left = rect.left;
  // keep on screen
  left = Math.min(window.innerWidth - popW - margin, Math.max(margin, left));
  // also keep below viewport bottom
  if (top + popH > window.innerHeight - margin) {
    top = Math.max(margin, window.innerHeight - popH - margin);
  }

  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
};

// ---------------------------------------------------------------------------
// The popover itself.
// ---------------------------------------------------------------------------

const KBD_SHORTCUT_HINT = navigator.platform.includes("Mac") ? "⌘↵" : "Ctrl+↵";
const KBD_SHORTCUT_FULL = navigator.platform.includes("Mac")
  ? "Press ⌘↵ to generate"
  : "Press Ctrl+↵ to generate";

const MAX_INSTRUCTION = 1000;

interface State {
  action: Action;
  tone: TonePreset;
  model: ModelId;
  instruction: string;
  streaming: boolean;
  preview: string;
  streamId: string | null;
  error: string | null;
  usageMeta: string;
  hasOutput: boolean;
  // Language controls.
  sourceLang: SourceLanguage; // "auto" or an explicit language id
  detectedLang: LanguageId | null; // result of auto-detection (UI hint only)
  targetChoice: TargetChoice; // the "To" picker value
  // Whether the Options disclosure (language + tone/model + instruction)
  // is expanded. Collapsed by default so the popover's primary surface is
  // just text in → result out; persisted across opens.
  optionsExpanded: boolean;
}

// Persistence helpers (optsExpanded, lastUsed, validators, TargetChoice
// type) live in ../lib/ui-state and are shared with the Side Panel so both
// surfaces open in sync.

export const mountPopover = async ({
  shadow,
  anchorRect,
  source,
  adapter,
  onClose,
}: MountArgs): Promise<void> => {
  // Load every piece of persisted UI state in parallel before any DOM is
  // built, so the popover paints in its final shape — correct action,
  // tone, model, language pair, working-language defaults, and expanded/
  // collapsed disclosure — with no flicker on first frame. The combined
  // chrome.storage.local round-trip resolves in a handful of milliseconds,
  // fast enough to keep the open feeling instant.
  const [initialOptsExpanded, lastUsed, settings] = await Promise.all([
    loadOptsExpanded(),
    loadLastUsed(),
    localStore.getAll().catch(() => null),
  ]);

  // field mode inserts the result back; selection/blank are copy-only.
  const canInsert = source.kind === "field";

  // Resolve initial values with precedence:
  //   validated lastUsed > options-page default > built-in default.
  const defaultTone: TonePreset = settings?.defaultTone ?? TONE_PRESETS[0]!;
  const defaultModel: ModelId = settings?.defaultModel ?? DEFAULT_MODEL_ID;
  const workingLanguage: LanguageId =
    settings?.workingLanguage ?? DEFAULT_WORKING_LANGUAGE;
  const frequentLanguages: LanguageId[] = settings?.frequentLanguages ?? [];

  const initialAction: Action = isValidAction(lastUsed.action)
    ? lastUsed.action
    : "reply";
  const initialTone: TonePreset = isValidTone(lastUsed.tone)
    ? lastUsed.tone
    : defaultTone;
  const initialModel: ModelId = isValidModel(lastUsed.model)
    ? lastUsed.model
    : defaultModel;
  const initialSourceLang: SourceLanguage = isValidSourceLang(lastUsed.sourceLang)
    ? lastUsed.sourceLang
    : "auto";
  const initialTargetChoice: TargetChoice = isValidTargetChoice(
    lastUsed.targetChoice,
  )
    ? lastUsed.targetChoice
    : "match";
  // ---- Style block (idempotent) ------------------------------------------
  shadow.querySelector("style[data-inkwell-popover]")?.remove();
  const style = document.createElement("style");
  style.setAttribute("data-inkwell-popover", "");
  style.textContent = POPOVER_STYLES;
  shadow.appendChild(style);

  // ---- Build static DOM once ---------------------------------------------
  const root = document.createElement("div");
  root.className = "pop";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "false");
  root.setAttribute("aria-labelledby", "inkwell-pop-title");
  root.tabIndex = -1;

  // Header
  const head = document.createElement("div");
  head.className = "head";
  const brand = document.createElement("span");
  brand.className = "brand-icon";
  brand.innerHTML = ICON_DROP;
  const titleWrap = document.createElement("div");
  const title = document.createElement("div");
  title.id = "inkwell-pop-title";
  title.className = "title";
  title.textContent = "Inkwell";
  const titleSub = document.createElement("div");
  titleSub.className = "title-sub";
  titleSub.textContent =
    source.kind === "selection"
      ? "Working on your selection"
      : source.kind === "blank"
        ? "Enter text below"
        : adapter.site === "generic"
          ? "Ready"
          : `On ${adapter.site}`;
  titleWrap.append(title, titleSub);
  const headSpacer = document.createElement("div");
  headSpacer.className = "head-spacer";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "icon-btn";
  closeBtn.setAttribute("aria-label", "Close (Esc)");
  closeBtn.title = "Close (Esc)";
  closeBtn.innerHTML = ICON_X;
  head.append(brand, titleWrap, headSpacer, closeBtn);

  // Body
  const body = document.createElement("div");
  body.className = "body";

  // Action segmented control
  const actions = document.createElement("div");
  actions.className = "actions";
  actions.setAttribute("role", "tablist");
  actions.setAttribute("aria-label", "Action");
  const actionButtons: Record<Action, HTMLButtonElement> = {
    reply: createActionButton("reply"),
    translate: createActionButton("translate"),
    grammar: createActionButton("grammar"),
    rewrite: createActionButton("rewrite"),
  };
  actions.append(
    actionButtons.reply,
    actionButtons.translate,
    actionButtons.grammar,
    actionButtons.rewrite,
  );

  const actionHint = document.createElement("p");
  actionHint.className = "action-hint";

  // "Your text" box — the subject text for selection / blank mode. In
  // field mode the text is read from the page field, so this stays hidden.
  const sourceWrap = document.createElement("div");
  sourceWrap.className = "source-wrap";
  const sourceLabel = document.createElement("label");
  sourceLabel.className = "lang-field-label";
  sourceLabel.htmlFor = "inkwell-source";
  const sourceEl = document.createElement("textarea");
  sourceEl.className = "source";
  sourceEl.id = "inkwell-source";
  sourceEl.spellcheck = true;
  sourceEl.rows = 3;
  // dir="auto" so a right-to-left customer message (e.g. Arabic) pasted
  // here renders correctly.
  sourceEl.dir = "auto";
  if (source.kind === "selection") sourceEl.value = source.text;
  sourceWrap.append(sourceLabel, sourceEl);
  if (canInsert) sourceWrap.style.display = "none";

  // Language row — "From" (source) and "To" (target) pickers. The target
  // picker is rebuilt per action by renderLanguageControls() and hidden
  // entirely for grammar (which never translates).
  const langRow = document.createElement("div");
  langRow.className = "lang-row";

  const sourceField = document.createElement("div");
  sourceField.className = "lang-field";
  const sourceFieldLabel = document.createElement("span");
  sourceFieldLabel.className = "lang-field-label";
  const sourceLabelText = document.createElement("span");
  sourceLabelText.textContent = "From";
  const sourceDetected = document.createElement("span");
  sourceDetected.className = "lang-detected";
  sourceFieldLabel.append(sourceLabelText, sourceDetected);
  const sourceSelect = document.createElement("select");
  sourceSelect.className = "lang-select";
  sourceSelect.setAttribute("aria-label", "Source language");
  {
    const autoOpt = document.createElement("option");
    autoOpt.value = "auto";
    autoOpt.textContent = "Auto-detect";
    sourceSelect.appendChild(autoOpt);
  }
  for (const l of LANGUAGE_CATALOG) {
    const opt = document.createElement("option");
    opt.value = l.id;
    opt.textContent = languageDisplayName(l.id);
    sourceSelect.appendChild(opt);
  }
  sourceField.append(sourceFieldLabel, sourceSelect);

  const langArrow = document.createElement("span");
  langArrow.className = "lang-arrow";
  langArrow.setAttribute("aria-hidden", "true");
  langArrow.innerHTML = ICON_ARROW_RIGHT;

  const targetField = document.createElement("div");
  targetField.className = "lang-field";
  const targetFieldLabel = document.createElement("span");
  targetFieldLabel.className = "lang-field-label";
  const targetSelect = document.createElement("select");
  targetSelect.className = "lang-select";
  targetSelect.setAttribute("aria-label", "Output language");
  targetField.append(targetFieldLabel, targetSelect);

  langRow.append(sourceField, langArrow, targetField);

  // Settings row — tone + model as compact selects that match the language
  // pickers, so every configuration control in the popover is the same kind
  // of widget rather than a mix of pills, dropdowns, and rows.
  const settingsRow = document.createElement("div");
  settingsRow.className = "lang-row";

  const toneField = document.createElement("div");
  toneField.className = "lang-field";
  const toneFieldLabel = document.createElement("label");
  toneFieldLabel.className = "lang-field-label";
  toneFieldLabel.textContent = "Tone";
  toneFieldLabel.htmlFor = "inkwell-tone-select";
  const toneSelect = document.createElement("select");
  toneSelect.className = "lang-select";
  toneSelect.id = "inkwell-tone-select";
  toneSelect.setAttribute("aria-label", "Tone");
  for (const t of TONE_PRESETS) {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = TONE_PRESET_LABELS[t];
    toneSelect.appendChild(opt);
  }
  toneField.append(toneFieldLabel, toneSelect);

  // Model selector — populated from the shared catalog. The option text is
  // just the short label ("GPT-4o mini"); the full description rides along
  // as a title tooltip rather than being truncated inside the control.
  const modelField = document.createElement("div");
  modelField.className = "lang-field";
  const modelLabel = document.createElement("label");
  modelLabel.className = "lang-field-label";
  modelLabel.textContent = "Model";
  modelLabel.htmlFor = "inkwell-model-select";
  const modelSelect = document.createElement("select");
  modelSelect.className = "lang-select";
  modelSelect.id = "inkwell-model-select";
  modelSelect.setAttribute("aria-label", "Model");
  for (const m of MODEL_CATALOG) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.label;
    opt.title = m.description;
    modelSelect.appendChild(opt);
  }
  modelField.append(modelLabel, modelSelect);

  settingsRow.append(toneField, modelField);

  // Instruction
  const instructionWrap = document.createElement("div");
  instructionWrap.className = "instruction-wrap";
  const instructionEl = document.createElement("textarea");
  instructionEl.className = "instruction";
  instructionEl.rows = 2;
  instructionEl.spellcheck = true;
  instructionEl.setAttribute("aria-label", "Instruction");
  instructionEl.maxLength = MAX_INSTRUCTION;
  const charCount = document.createElement("span");
  charCount.className = "char-count";
  charCount.setAttribute("aria-live", "off");
  instructionWrap.append(instructionEl, charCount);

  // Preview
  const previewWrap = document.createElement("div");
  previewWrap.className = "preview-wrap";
  previewWrap.setAttribute("data-state", "empty");
  const previewEl = document.createElement("div");
  previewEl.className = "preview preview-empty";
  previewEl.setAttribute("aria-live", "polite");
  previewEl.setAttribute("aria-atomic", "false");
  // dir="auto" so right-to-left output (Arabic, etc.) renders correctly.
  previewEl.dir = "auto";
  previewWrap.append(previewEl);

  const errEl = document.createElement("div");
  errEl.className = "err";
  errEl.style.display = "none";
  errEl.setAttribute("role", "alert");

  // ---- Options disclosure ------------------------------------------------
  // Wraps language + tone/model + the optional instruction so the popover's
  // primary surface stays focused on the use case (text in → result out).
  // Collapsed by default; expand to reveal the configuration controls. The
  // expanded/collapsed state and a one-line summary of the current settings
  // are persisted across popover opens.
  const optsSection = document.createElement("div");
  optsSection.className = "opts";

  const optsToggle = document.createElement("button");
  optsToggle.type = "button";
  optsToggle.className = "opts-toggle";
  optsToggle.setAttribute("aria-expanded", String(initialOptsExpanded));
  optsToggle.setAttribute("aria-controls", "inkwell-opts-body");
  // Sliders icon makes the disclosure read as "settings / configuration"
  // at a glance — clearer than text alone.
  const optsIcon = document.createElement("span");
  optsIcon.className = "opts-icon";
  optsIcon.setAttribute("aria-hidden", "true");
  optsIcon.innerHTML = ICON_SLIDERS;
  const optsText = document.createElement("span");
  optsText.className = "opts-text";
  optsText.textContent = "Options";
  const optsChevron = document.createElement("span");
  optsChevron.className = "opts-chevron";
  optsChevron.setAttribute("aria-hidden", "true");
  optsChevron.innerHTML = ICON_CHEVRON_DOWN;
  optsToggle.append(optsIcon, optsText, optsChevron);

  const optsBody = document.createElement("div");
  optsBody.className = "opts-body";
  optsBody.id = "inkwell-opts-body";
  const optsInner = document.createElement("div");
  optsInner.className = "opts-inner";
  optsInner.append(langRow, settingsRow, instructionWrap);
  optsBody.append(optsInner);

  optsSection.append(optsToggle, optsBody);

  body.append(
    actions,
    actionHint,
    sourceWrap,
    optsSection,
    previewWrap,
    errEl,
  );

  // Footer
  const footer = document.createElement("div");
  footer.className = "footer";
  const meta = document.createElement("div");
  meta.className = "meta";
  const cancelBtn = createButton("Cancel", "btn-secondary", ICON_SQUARE);
  cancelBtn.style.display = "none";
  const regenBtn = createButton("Regenerate", "btn-secondary", ICON_REFRESH);
  regenBtn.style.display = "none";
  // Copy is shown alongside Insert in field mode, and is the primary
  // action in selection / blank mode (where there's nothing to insert into).
  const copyBtn = createButton("Copy", "btn-secondary", ICON_COPY);
  copyBtn.style.display = "none";
  const primaryBtn = createButton("Generate", "btn-primary accent", ICON_ARROW_RIGHT);
  primaryBtn.setAttribute("aria-keyshortcuts", "Meta+Enter");
  footer.append(meta, regenBtn, cancelBtn, copyBtn, primaryBtn);

  root.append(head, body, footer);
  shadow.appendChild(root);

  // First paint, then position (so offsetHeight is available).
  requestAnimationFrame(() => positionPopover(root, anchorRect));

  // ---- State -------------------------------------------------------------
  const state: State = {
    action: initialAction,
    tone: initialTone,
    model: initialModel,
    instruction: "",
    streaming: false,
    preview: "",
    streamId: null,
    error: null,
    usageMeta: KBD_SHORTCUT_FULL,
    hasOutput: false,
    sourceLang: initialSourceLang,
    detectedLang: null,
    targetChoice: initialTargetChoice,
    optionsExpanded: initialOptsExpanded,
  };
  modelSelect.value = state.model;

  // Carries the metadata of the in-flight request so a finished stream can
  // be written to history (which needs both the input and the output text).
  let pendingHistory: NewHistoryEntry | null = null;

  // ---- Bindings (these update only the elements that depend on each var)
  const renderActionVisuals = (): void => {
    for (const a of Object.keys(actionButtons) as Action[]) {
      const selected = a === state.action;
      actionButtons[a].setAttribute("aria-selected", String(selected));
      actionButtons[a].tabIndex = selected ? 0 : -1;
    }
    actionHint.textContent = ACTION_HINTS[state.action];
    instructionEl.placeholder = INSTRUCTION_PLACEHOLDERS[state.action];
    sourceLabel.textContent = SOURCE_LABELS[state.action];
    sourceEl.placeholder = SOURCE_PLACEHOLDERS[state.action];
    // Tone has no effect on a faithful translation — hide the control for
    // translate so the settings row only shows what actually applies.
    toneField.style.display = state.action === "translate" ? "none" : "";
  };

  // Language ids ordered so the agent's frequently-used languages come
  // first in the pickers, then the rest of the catalog.
  const orderedLanguages = (): LanguageId[] => {
    const freq = frequentLanguages.filter((id) => getLanguageInfo(id));
    const rest = LANGUAGE_CATALOG.map((l) => l.id).filter(
      (id) => !freq.includes(id),
    );
    return [...freq, ...rest];
  };

  // (Re)build the "To" picker's options for the current action.
  const buildTargetOptions = (): void => {
    targetSelect.replaceChildren();
    const addOption = (value: string, label: string): void => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      targetSelect.appendChild(opt);
    };
    const addLanguageOptions = (): void => {
      const ids = orderedLanguages();
      const freqCount = frequentLanguages.length;
      // Group into "Frequent" + "All languages" only when that split is
      // meaningful (some, but not all, languages are marked frequent).
      if (freqCount > 0 && freqCount < ids.length) {
        const frequentGroup = document.createElement("optgroup");
        frequentGroup.label = "Frequent";
        const allGroup = document.createElement("optgroup");
        allGroup.label = "All languages";
        ids.forEach((id, i) => {
          const opt = document.createElement("option");
          opt.value = id;
          opt.textContent = languageDisplayName(id);
          (i < freqCount ? frequentGroup : allGroup).appendChild(opt);
        });
        targetSelect.append(frequentGroup, allGroup);
      } else {
        for (const id of ids) addOption(id, languageDisplayName(id));
      }
    };

    if (state.action === "translate") {
      addLanguageOptions();
    } else if (state.action === "reply") {
      addOption("match", "Customer's language");
      addOption("bilingual", `Bilingual (+ ${languageLabel(workingLanguage)})`);
      addLanguageOptions();
    } else {
      // rewrite
      addOption("match", "Keep source language");
      addLanguageOptions();
    }
  };

  // Sync the whole language row to state: the detected-language hint, the
  // visible/hidden "To" field, its option set, and the two select values.
  const renderLanguageControls = (): void => {
    // Grammar has no "To" field, so "Language" reads better than "From".
    sourceLabelText.textContent =
      state.action === "grammar" ? "Language" : "From";
    if (state.sourceLang === "auto") {
      sourceDetected.textContent = state.detectedLang
        ? ` · ${languageLabel(state.detectedLang)}`
        : "";
    } else {
      sourceDetected.textContent = "";
    }
    sourceSelect.value = state.sourceLang;

    // Grammar never translates — there is no target language to pick.
    const showTarget = state.action !== "grammar";
    targetField.style.display = showTarget ? "" : "none";
    langArrow.style.display = showTarget ? "" : "none";
    if (!showTarget) return;

    targetFieldLabel.textContent =
      state.action === "translate"
        ? "Translate to"
        : state.action === "reply"
          ? "Reply in"
          : "Output language";

    buildTargetOptions();

    // Coerce targetChoice to a value that actually exists in the rebuilt
    // option list (e.g. after switching away from a "bilingual" reply).
    const wanted = String(state.targetChoice);
    const exists = Array.from(targetSelect.options).some(
      (o) => o.value === wanted,
    );
    if (!exists) {
      state.targetChoice =
        state.action === "translate" ? workingLanguage : "match";
    }
    targetSelect.value = String(state.targetChoice);
  };

  const renderToneVisuals = (): void => {
    toneSelect.value = state.tone;
  };

  const renderCharCount = (): void => {
    const len = state.instruction.length;
    charCount.textContent = `${len}/${MAX_INSTRUCTION}`;
    charCount.classList.toggle("warn", len > MAX_INSTRUCTION * 0.9 && len <= MAX_INSTRUCTION);
    charCount.classList.toggle("over", len > MAX_INSTRUCTION);
  };

  const renderPreviewState = (): void => {
    if (state.error) {
      previewWrap.dataset["state"] = "error";
    } else if (state.streaming) {
      previewWrap.dataset["state"] = "streaming";
    } else if (state.preview) {
      previewWrap.dataset["state"] = "ready";
    } else {
      previewWrap.dataset["state"] = "empty";
    }

    if (state.preview) {
      previewEl.classList.remove("preview-empty");
      previewEl.classList.toggle("caret", state.streaming);
      previewEl.textContent = state.preview;
      previewWrap.scrollTop = previewWrap.scrollHeight;
    } else if (state.streaming) {
      // Streaming has started but no token has landed yet — an animated
      // indicator reads as "working" far better than static text.
      previewEl.classList.remove("preview-empty", "caret");
      previewEl.replaceChildren(buildThinkingIndicator());
    } else {
      previewEl.classList.add("preview-empty");
      previewEl.classList.remove("caret");
      previewEl.textContent = "Your result will appear here.";
    }

    if (state.error) {
      errEl.style.display = "";
      errEl.innerHTML = "";
      const icon = document.createElement("span");
      icon.innerHTML = ICON_X;
      const msg = document.createElement("span");
      msg.textContent = state.error;
      errEl.append(icon, msg);
    } else {
      errEl.style.display = "none";
    }
  };

  // Whether the result can be written back into the page. Field mode allows
  // it — except for "translate", whose output is a rendering of someone
  // else's message, not something you'd paste into your own draft.
  const insertable = (): boolean =>
    source.kind === "field" && state.action !== "translate";

  const renderFooter = (): void => {
    meta.textContent = state.usageMeta;
    // Settings can't change mid-stream — lock every control while streaming.
    modelSelect.disabled = state.streaming;
    toneSelect.disabled = state.streaming;
    sourceSelect.disabled = state.streaming;
    targetSelect.disabled = state.streaming;
    const ready = state.hasOutput && !!state.preview && !state.error;
    if (state.streaming) {
      cancelBtn.style.display = "";
      regenBtn.style.display = "none";
      copyBtn.style.display = "none";
      primaryBtn.style.display = "none";
    } else if (ready) {
      // There's a result. Regenerate is always offered. When the result can
      // be inserted, that is the primary action (with Copy secondary);
      // otherwise Copy is the primary action.
      cancelBtn.style.display = "none";
      regenBtn.style.display = "";
      primaryBtn.style.display = "";
      primaryBtn.classList.remove("accent");
      primaryBtn.classList.add("btn-primary");
      if (insertable()) {
        copyBtn.style.display = "";
        setButtonLabel(primaryBtn, "Insert", ICON_CHECK);
      } else {
        copyBtn.style.display = "none";
        setButtonLabel(primaryBtn, "Copy", ICON_COPY);
      }
    } else {
      cancelBtn.style.display = "none";
      regenBtn.style.display = "none";
      copyBtn.style.display = "none";
      primaryBtn.style.display = "";
      setButtonLabel(primaryBtn, "Generate", ICON_ARROW_RIGHT);
      primaryBtn.classList.add("accent");
    }
  };

  // Inline summary appended to "Options · …" in the disclosure header. Lets
  // the user verify the language pair, tone (where it applies), model, and
  // whether a custom instruction is set — without having to expand.
  const computeOptsSummary = (): string => {
    const parts: string[] = [];
    const srcShown =
      state.sourceLang === "auto"
        ? state.detectedLang
          ? languageLabel(state.detectedLang)
          : "Auto"
        : languageLabel(state.sourceLang);

    if (state.action === "grammar") {
      parts.push(srcShown);
    } else {
      let tgtShown: string;
      if (state.targetChoice === "match") {
        tgtShown =
          state.action === "reply" ? "Customer's lang" : "Same as source";
      } else if (state.targetChoice === "bilingual") {
        tgtShown = "Bilingual";
      } else {
        tgtShown = languageLabel(state.targetChoice as LanguageId);
      }
      parts.push(`${srcShown} → ${tgtShown}`);
    }

    if (state.action !== "translate") {
      parts.push(TONE_PRESET_LABELS[state.tone]);
    }
    const m = MODEL_CATALOG.find((x) => x.id === state.model);
    if (m) parts.push(m.label);
    if (state.instruction.trim()) parts.push("custom note");

    return parts.join(" · ");
  };

  const renderOptionsToggle = (): void => {
    optsToggle.setAttribute("aria-expanded", String(state.optionsExpanded));
    optsText.textContent = `Options · ${computeOptsSummary()}`;
  };

  const renderAll = (): void => {
    renderActionVisuals();
    renderLanguageControls();
    renderToneVisuals();
    renderCharCount();
    renderPreviewState();
    renderFooter();
    renderOptionsToggle();
  };

  // ---- Language detection ------------------------------------------------
  // chrome.i18n.detectLanguage runs locally and instantly. The result only
  // labels the UI and tags history — the backend model still detects the
  // language itself, so a miss here costs nothing but a hint.
  let detectTimer = 0;
  const runDetection = async (text: string): Promise<void> => {
    const result = await detectLanguage(text);
    state.detectedLang = result ? result.language : null;
    if (state.sourceLang === "auto") {
      renderLanguageControls();
      renderOptionsToggle();
    }
  };
  const scheduleDetection = (text: string): void => {
    window.clearTimeout(detectTimer);
    detectTimer = window.setTimeout(() => void runDetection(text), 400);
  };

  // The text an action operates on — used for detection and the history
  // entry. For grammar/rewrite that is the draft; for reply/translate it
  // is the incoming message.
  const subjectText = (ctx: RequestContext): string => {
    if (state.action === "grammar" || state.action === "rewrite") {
      return ctx.draft ?? "";
    }
    if (ctx.post) return ctx.post.text;
    if (ctx.thread && ctx.thread.length > 0) {
      return ctx.thread[ctx.thread.length - 1]?.text ?? "";
    }
    return ctx.draft ?? "";
  };

  // Field mode caches the extracted context once so the "From" badge can
  // be populated on open — and kept in sync as the action changes —
  // without re-scraping the page each time.
  let fieldContext: RequestContext | null = null;
  const detectFieldLanguage = async (): Promise<void> => {
    if (source.kind !== "field" || state.sourceLang !== "auto") return;
    let text: string;
    if (state.action === "grammar" || state.action === "rewrite") {
      // The draft is cheap to read fresh from the element.
      text = readText(source.element);
    } else {
      // reply / translate work on the incoming thread/post.
      if (!fieldContext) {
        try {
          fieldContext = await adapter.extractContext(source.element);
        } catch {
          fieldContext = null;
        }
      }
      text = fieldContext ? subjectText(fieldContext) : "";
    }
    if (text.trim()) {
      await runDetection(text);
    } else {
      state.detectedLang = null;
      renderLanguageControls();
    }
  };

  // ---- Wire interactions -------------------------------------------------
  const setAction = (a: Action): void => {
    if (state.streaming || a === state.action) return;
    state.action = a;
    // Reset the "To" picker to a sensible default for the new action.
    if (a === "translate") {
      state.targetChoice = isLanguageId(state.targetChoice)
        ? state.targetChoice
        : workingLanguage;
    } else if (a !== "grammar") {
      // reply / rewrite default to matching the source language.
      state.targetChoice = "match";
    }
    // Switching action starts a fresh task: discard any prior result so the
    // footer never offers to insert/copy output produced by a different
    // action (a translation is not something you'd insert as a reply).
    state.preview = "";
    state.hasOutput = false;
    state.error = null;
    state.usageMeta = KBD_SHORTCUT_FULL;
    pendingHistory = null;
    renderAll();
    // The subject text differs per action in field mode (incoming thread
    // vs. the draft), so refresh the detected-language badge.
    void detectFieldLanguage();
    // Persist so the next popover opens on the same action.
    saveLastUsed(state);
  };
  for (const a of Object.keys(actionButtons) as Action[]) {
    actionButtons[a].addEventListener("click", () => setAction(a));
  }
  toneSelect.addEventListener("change", () => {
    // Option values come straight from TONE_PRESETS, so this is always valid.
    state.tone = toneSelect.value as TonePreset;
    renderOptionsToggle();
    saveLastUsed(state);
  });
  modelSelect.addEventListener("change", () => {
    // The <option> values come straight from MODEL_CATALOG, so the value is
    // always a valid ModelId.
    state.model = modelSelect.value as ModelId;
    renderOptionsToggle();
    saveLastUsed(state);
  });
  sourceSelect.addEventListener("change", () => {
    // Values are "auto" or a catalog language id — both valid SourceLanguage.
    state.sourceLang = sourceSelect.value as SourceLanguage;
    if (state.sourceLang === "auto") {
      // Re-detect from whatever text is currently available.
      if (source.kind === "field") void detectFieldLanguage();
      else void runDetection(sourceEl.value);
    }
    renderLanguageControls();
    renderOptionsToggle();
    saveLastUsed(state);
  });
  targetSelect.addEventListener("change", () => {
    // Values are "match", "bilingual", or a catalog language id.
    state.targetChoice = targetSelect.value as TargetChoice;
    renderOptionsToggle();
    saveLastUsed(state);
  });
  instructionEl.addEventListener("input", () => {
    state.instruction = instructionEl.value;
    renderCharCount();
    renderOptionsToggle();
  });

  // Expand/collapse the Options disclosure. The state is per-device and
  // persisted, so a user who routinely tweaks settings doesn't re-open it
  // every time the popover mounts.
  optsToggle.addEventListener("click", () => {
    state.optionsExpanded = !state.optionsExpanded;
    renderOptionsToggle();
    saveOptsExpanded(state.optionsExpanded);
  });

  sourceEl.addEventListener("input", () => {
    // Clearing a stale error as soon as the user edits the text feels
    // responsive; the next generate revalidates anyway.
    if (state.error) {
      state.error = null;
      renderPreviewState();
    }
    if (state.sourceLang === "auto") scheduleDetection(sourceEl.value);
  });

  closeBtn.addEventListener("click", () => teardown(false));

  const ready = (): boolean =>
    state.hasOutput && !!state.preview && !state.error;

  primaryBtn.addEventListener("click", () => {
    if (state.streaming) return;
    if (!ready()) {
      void start();
    } else if (insertable()) {
      insert();
    } else {
      void copyResult();
    }
  });
  copyBtn.addEventListener("click", () => void copyResult());
  regenBtn.addEventListener("click", () => void start());
  cancelBtn.addEventListener("click", () => cancelStream());

  // Keyboard shortcuts (scoped to popover lifetime).
  const keydown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      teardown(false);
      return;
    }
    // Cmd/Ctrl+Enter: generate, then insert (field) or copy (selection).
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.stopPropagation();
      e.preventDefault();
      if (state.streaming) return;
      if (!ready()) void start();
      else if (insertable()) insert();
      else void copyResult();
    }
  };
  // Listen on the shadow root so events from inside still fire; bubble
  // up to document for clicks landing on host page.
  const sRoot = shadow as unknown as ShadowRoot & { host?: HTMLElement };
  // Shadow doesn't dispatch keyboard events to document by default in a
  // closed shadow root; addEventListener on the host element catches them.
  if (sRoot.host) {
    sRoot.host.addEventListener("keydown", keydown, true);
  }
  // Also listen on the popover itself for in-shadow targets.
  root.addEventListener("keydown", keydown, true);

  // Outside-click closes (but not when click is inside the same shadow).
  const onDocClick = (e: MouseEvent): void => {
    // The popover lives in a CLOSED shadow root, so composedPath() does not
    // expose its internal nodes to this document-level listener — only the
    // shadow host. Testing `root` here can never match, which dismissed the
    // popover on every click inside it, Generate included. Match the host,
    // with the retargeted event.target (also the host) as a fallback.
    if (sRoot.host && e.composedPath().includes(sRoot.host)) return;
    const t = e.target;
    if (t instanceof Element && t.closest("[data-inkwell-root]")) return;
    teardown(false);
  };
  document.addEventListener("mousedown", onDocClick, true);

  // ---- Streaming wiring --------------------------------------------------
  const onStreamMessage = (msg: unknown): void => {
    if (!msg || typeof msg !== "object" || !("type" in msg)) return;
    const m = msg as
      | CompleteTokenMessage
      | CompleteDoneMessage
      | CompleteErrorMessage
      | CompleteUsageMessage;
    if ("streamId" in m && m.streamId !== state.streamId) return;

    switch (m.type) {
      case MESSAGE_TYPES.COMPLETE_TOKEN: {
        state.preview += (m as CompleteTokenMessage).delta;
        // Don't trigger a full re-render; just patch preview.
        if (previewEl.classList.contains("preview-empty")) {
          previewEl.classList.remove("preview-empty");
        }
        previewEl.classList.add("caret");
        previewEl.textContent = state.preview;
        previewWrap.dataset["state"] = "streaming";
        previewWrap.scrollTop = previewWrap.scrollHeight;
        return;
      }
      case MESSAGE_TYPES.COMPLETE_USAGE: {
        const u = (m as CompleteUsageMessage).usage;
        if (u) state.usageMeta = `${u.model ?? ""} · ${u.totalTokens ?? 0} tokens`;
        meta.textContent = state.usageMeta;
        return;
      }
      case MESSAGE_TYPES.COMPLETE_DONE: {
        state.streaming = false;
        state.streamId = null;
        state.hasOutput = true;
        // Record the completed action in the local, searchable history.
        if (pendingHistory && state.preview.trim()) {
          void historyStore.add({
            ...pendingHistory,
            outputText: state.preview,
          });
        }
        pendingHistory = null;
        renderAll();
        primaryBtn.focus();
        return;
      }
      case MESSAGE_TYPES.COMPLETE_ERROR: {
        const err = (m as CompleteErrorMessage).error;
        state.streaming = false;
        state.streamId = null;
        state.error = err.message || "Something went wrong";
        pendingHistory = null;
        renderAll();
        return;
      }
    }
  };
  chrome.runtime.onMessage.addListener(onStreamMessage);

  // ---- Actions -----------------------------------------------------------

  // Build the request context. In field mode the site adapter scrapes the
  // page; in selection/blank mode the text comes from the "your text" box.
  const buildContext = async (): Promise<RequestContext | { error: string }> => {
    if (source.kind === "field") {
      const ctx = await adapter.extractContext(source.element);
      const hasPageContext = !!(ctx.thread?.length || ctx.post);
      const hasDraft = !!(ctx.draft && ctx.draft.trim());
      // A field on a site with no adapter (or where the adapter found
      // nothing) yields no conversation to work from. Catch that here with
      // a clear, actionable message instead of letting the backend reject
      // it with a generic schema error.
      if (state.action === "reply" && !hasPageContext) {
        return {
          error:
            "Couldn't find a message to reply to on this page. Select the " +
            "customer's message, then click the Inkwell icon.",
        };
      }
      if (state.action === "translate" && !hasPageContext && !hasDraft) {
        return {
          error:
            "Nothing to translate here. Select the text you want translated, " +
            "then click the Inkwell icon.",
        };
      }
      if (state.action === "grammar" && !hasDraft) {
        return {
          error: "Type something in the field first, then fix its grammar.",
        };
      }
      if (
        state.action === "rewrite" &&
        !hasDraft &&
        !hasPageContext &&
        !state.instruction.trim()
      ) {
        return {
          error:
            "Type a draft to rewrite, or open Options to describe what " +
            "to write.",
        };
      }
      return ctx;
    }
    const text = sourceEl.value.trim();
    const instruction = state.instruction.trim();
    if (state.action === "reply" && !text) {
      return { error: "Add the text you want to reply to." };
    }
    if (state.action === "translate" && !text) {
      return { error: "Add the text you want to translate." };
    }
    if (state.action === "grammar" && !text) {
      return { error: "Add the text you want grammar-fixed." };
    }
    if (state.action === "rewrite" && !text && !instruction) {
      return {
        error: "Add text to rewrite, or open Options to describe what to write.",
      };
    }
    const base = {
      site: source.kind === "selection" ? "selection" : "manual",
      pageTitle: document.title.slice(0, 300),
      pageUrl: window.location.origin + window.location.pathname,
    };
    // 'reply' and 'translate' treat the text as an incoming message; the
    // other actions treat it as the draft to transform.
    return state.action === "reply" || state.action === "translate"
      ? { ...base, post: { text } }
      : { ...base, draft: text };
  };

  const start = async (): Promise<void> => {
    if (state.streaming) return;

    let ctx: RequestContext;
    try {
      const built = await buildContext();
      if ("error" in built) {
        state.error = built.error;
        // Auto-expand Options when the missing input lives there. Currently
        // that's the rewrite-without-text path — the instruction is hidden
        // in the collapsed disclosure, and silently expanding lets the user
        // act on the guidance without an extra click.
        if (state.action === "rewrite" && !state.instruction.trim()) {
          state.optionsExpanded = true;
          renderOptionsToggle();
          saveOptsExpanded(true);
        }
        renderPreviewState();
        renderFooter();
        return;
      }
      ctx = built;
    } catch (err: unknown) {
      state.error =
        err instanceof Error ? err.message : "Couldn't read the text.";
      renderPreviewState();
      renderFooter();
      return;
    }

    // Resolve the source language. An explicit pick wins; otherwise detect
    // it from the subject text so the request and the history entry are
    // both tagged with a concrete language.
    const subject = subjectText(ctx);
    if (state.sourceLang === "auto" && subject) {
      const detected = await detectLanguage(subject);
      if (detected) state.detectedLang = detected.language;
    }
    const sourceLanguage: SourceLanguage =
      state.sourceLang !== "auto"
        ? state.sourceLang
        : (state.detectedLang ?? "auto");

    // Resolve the target language + bilingual flag from the "To" picker.
    let targetLanguage: LanguageId | undefined;
    let bilingual = false;
    if (state.action === "translate") {
      targetLanguage = isLanguageId(state.targetChoice)
        ? state.targetChoice
        : workingLanguage;
    } else if (state.action === "reply" || state.action === "rewrite") {
      if (state.targetChoice === "bilingual") {
        bilingual = true;
        targetLanguage = workingLanguage;
      } else if (isLanguageId(state.targetChoice)) {
        targetLanguage = state.targetChoice;
      }
    }

    // Stash request metadata so a successful COMPLETE_DONE can record it.
    pendingHistory = {
      action: state.action,
      sourceLanguage,
      targetLanguage: targetLanguage ?? null,
      bilingual,
      inputText: subject,
      outputText: "",
      site: ctx.site ?? adapter.site,
      conversationUrl:
        ctx.pageUrl ?? window.location.origin + window.location.pathname,
      pageTitle: ctx.pageTitle ?? document.title,
    };

    state.preview = "";
    state.error = null;
    state.usageMeta = "Streaming…";
    state.hasOutput = false;
    state.streaming = true;
    state.streamId = crypto.randomUUID();
    renderAll();

    try {
      const startMsg: CompleteStartMessage = {
        type: MESSAGE_TYPES.COMPLETE_START,
        streamId: state.streamId,
        payload: {
          action: state.action,
          context: ctx,
          tone: state.tone,
          model: state.model,
          instruction: state.instruction.trim() || undefined,
          sourceLanguage,
          ...(targetLanguage ? { targetLanguage } : {}),
          ...(bilingual ? { bilingual: true } : {}),
        },
      };
      const ack = await sendToBackground<{ ok: boolean }>(startMsg);
      if (!ack?.ok) {
        state.streaming = false;
        state.streamId = null;
        state.error = "Backend rejected the request.";
        pendingHistory = null;
        renderAll();
      }
    } catch (err: unknown) {
      state.streaming = false;
      state.streamId = null;
      state.error = err instanceof Error ? err.message : "Failed to start.";
      pendingHistory = null;
      renderAll();
    }
  };

  const cancelStream = (): void => {
    if (!state.streamId) return;
    const cancelMsg: CompleteCancelMessage = {
      type: MESSAGE_TYPES.COMPLETE_CANCEL,
      streamId: state.streamId,
    };
    void sendToBackground(cancelMsg);
    state.streaming = false;
    state.streamId = null;
    state.usageMeta = "Cancelled";
    // A cancelled stream is not recorded in history.
    pendingHistory = null;
    renderAll();
  };

  // Insert the result back into the editable field (field mode only).
  const insert = (): void => {
    if (!state.preview || source.kind !== "field") return;
    if (state.action === "reply") {
      writeText(source.element, state.preview);
    } else {
      replaceFieldText(source.element, state.preview);
    }
    teardown(true);
  };

  // Write `text` to the clipboard via execCommand on a hidden textarea.
  // This is the primary copy path because, unlike navigator.clipboard, it
  // is NOT gated by the host page's Permissions-Policy and works reliably
  // from a content script inside a click gesture (navigator.clipboard is
  // blocked outright on some sites — Medium, for one). Returns false if
  // the copy did not take.
  const writeClipboard = (text: string): boolean => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText =
      "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  };

  // Copy the result to the clipboard. We never write to the page in
  // selection/blank mode — the user pastes it wherever they want. The
  // popover stays open so they can copy again or regenerate.
  let copyResetTimer = 0;
  const copyResult = async (): Promise<void> => {
    if (!state.preview) return;
    const target = insertable() ? copyBtn : primaryBtn;

    let ok = writeClipboard(state.preview);
    if (!ok) {
      // Fallback to the async Clipboard API (permissive pages still allow
      // it; the click gesture may already be spent, hence the fallback).
      try {
        await navigator.clipboard.writeText(state.preview);
        ok = true;
      } catch {
        ok = false;
      }
    }

    if (ok) {
      setButtonLabel(target, "Copied", ICON_CHECK);
      target.focus();
      window.clearTimeout(copyResetTimer);
      copyResetTimer = window.setTimeout(() => {
        setButtonLabel(target, "Copy", ICON_COPY);
      }, 1600);
    } else {
      state.error =
        "Couldn't copy to the clipboard. Select the text in the preview above and copy it manually.";
      renderPreviewState();
    }
  };

  const teardown = (insertedSuccessfully: boolean): void => {
    chrome.runtime.onMessage.removeListener(onStreamMessage);
    document.removeEventListener("mousedown", onDocClick, true);
    if (sRoot.host) sRoot.host.removeEventListener("keydown", keydown, true);
    root.removeEventListener("keydown", keydown, true);
    window.clearTimeout(copyResetTimer);
    window.clearTimeout(detectTimer);
    if (state.streamId) cancelStream();
    root.remove();
    style.remove();
    onClose();
    if (insertedSuccessfully && source.kind === "field") {
      source.element.focus();
    }
  };

  // Initial render + focus. In selection / blank mode focus the "your
  // text" box (it's the primary input); in field mode focus the
  // instruction box. Deferred past the entrance animation.
  renderAll();
  setTimeout(
    () => (canInsert ? instructionEl : sourceEl).focus(),
    30,
  );

  // Populate the "From" badge as soon as the popover opens — from the
  // selected/typed text, or by reading the focused field and its
  // surrounding conversation.
  if (source.kind === "field") void detectFieldLanguage();
  else void runDetection(sourceEl.value);

  // All defaults (tone, model, languages, working language, frequent
  // languages) are loaded pre-paint via the Promise.all at the top of
  // mountPopover — no post-paint reapply needed.
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// The pre-token "thinking" indicator: a label plus three pulsing dots.
const buildThinkingIndicator = (): HTMLElement => {
  const wrap = document.createElement("span");
  wrap.className = "thinking";
  const label = document.createElement("span");
  label.textContent = "Thinking";
  const dots = document.createElement("span");
  dots.className = "thinking-dots";
  dots.append(
    document.createElement("i"),
    document.createElement("i"),
    document.createElement("i"),
  );
  wrap.append(label, dots);
  return wrap;
};

const createActionButton = (action: Action): HTMLButtonElement => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "action";
  btn.setAttribute("role", "tab");
  btn.setAttribute("aria-selected", "false");
  btn.dataset["action"] = action;
  const icon = document.createElement("span");
  icon.innerHTML = ACTION_ICONS[action];
  const label = document.createElement("span");
  label.textContent = ACTION_LABELS[action];
  btn.append(icon.firstElementChild as Node, label);
  return btn;
};

const createButton = (
  label: string,
  variantClass: string,
  iconSvg: string,
): HTMLButtonElement => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `btn ${variantClass}`;
  setButtonLabel(btn, label, iconSvg);
  return btn;
};

const setButtonLabel = (
  btn: HTMLButtonElement,
  label: string,
  iconSvg: string,
): void => {
  btn.replaceChildren();
  const text = document.createElement("span");
  text.textContent = label;
  btn.append(text);
  const wrapper = document.createElement("span");
  wrapper.innerHTML = iconSvg;
  const icon = wrapper.firstElementChild;
  if (icon) btn.append(icon);
  // Add a kbd hint for the primary "Generate" button.
  if (label === "Generate") {
    const kbd = document.createElement("span");
    kbd.className = "kbd";
    kbd.textContent = KBD_SHORTCUT_HINT;
    btn.append(kbd);
  }
};

const replaceFieldText = (el: HTMLElement, text: string): void => {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus();
    el.select();
    el.setRangeText(text, 0, el.value.length, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  if (el.isContentEditable) {
    el.focus();
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.addRange(range);
      try {
        document.execCommand("insertText", false, text);
        return;
      } catch {
        /* ignore */
      }
    }
    el.textContent = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
};
