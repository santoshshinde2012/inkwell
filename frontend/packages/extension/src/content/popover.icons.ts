// Popover icon + label catalogs — extracted from popover.ts so the main
// file stays focused on DOM construction.
//
// All SVGs are Lucide-style (MIT, https://lucide.dev) and inlined as
// strings; the popover's closed Shadow DOM injects them via innerHTML
// without any extra fetch. Every icon shares a common attribute prefix
// (stroke / fill / line-cap conventions) so visual scale stays
// consistent across the popover.

import type { Action } from "@inkwell/shared";

const SVG_ATTRS =
  'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

export const ICON_REPLY = `<svg ${SVG_ATTRS}><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>`;
export const ICON_GRAMMAR = `<svg ${SVG_ATTRS}><path d="m6 16 6-12 6 12"/><path d="M8 12h8"/><path d="m16 20 2 2 4-4"/></svg>`;
export const ICON_REWRITE = `<svg ${SVG_ATTRS}><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`;
// The Inkwell brand mark — a filled ink drop. Matches icons/logo.svg.
export const ICON_DROP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.88C13.13 6.94 16.13 9 16.13 11.44A5.25 5.25 0 1 1 7.88 11.44C7.88 9 10.88 6.94 12 4.88Z"/></svg>`;
export const ICON_X = `<svg ${SVG_ATTRS}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
export const ICON_CHECK = `<svg ${SVG_ATTRS}><path d="M20 6 9 17l-5-5"/></svg>`;
export const ICON_REFRESH = `<svg ${SVG_ATTRS}><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>`;
export const ICON_SQUARE = `<svg ${SVG_ATTRS}><rect width="14" height="14" x="5" y="5" rx="1.5"/></svg>`;
export const ICON_ARROW_RIGHT = `<svg ${SVG_ATTRS}><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`;
export const ICON_CHEVRON_DOWN = `<svg ${SVG_ATTRS}><path d="m6 9 6 6 6-6"/></svg>`;
// Lucide "sliders-horizontal" — signifies "settings / adjust" in the
// Options disclosure. Reads instantly even at 14px.
export const ICON_SLIDERS = `<svg ${SVG_ATTRS}><line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><circle cx="14" cy="4" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="16" cy="20" r="2"/></svg>`;
export const ICON_COPY = `<svg ${SVG_ATTRS}><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
export const ICON_TRANSLATE = `<svg ${SVG_ATTRS}><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>`;
// Lucide "panel-right-open" — represents the Chrome side panel docked on
// the right. Used by the header button that hands the popover's working
// text off to the side panel.
export const ICON_PANEL_RIGHT = `<svg ${SVG_ATTRS}><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m8 9 3 3-3 3"/></svg>`;
// Lucide "grip-vertical" — six-dot drag affordance. Shown on hover at the
// far-left of the header so users discover the popover is draggable.
export const ICON_GRIP = `<svg ${SVG_ATTRS}><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>`;

// ---------------------------------------------------------------------------
// Per-action labels, hints, and placeholders rendered in the popover.
// Keys are exhaustive over `Action` so adding a new action trips the type
// checker until every map is updated.
// ---------------------------------------------------------------------------

export const ACTION_LABELS: Record<Action, string> = {
  reply: "Reply",
  translate: "Translate",
  grammar: "Grammar",
  rewrite: "Rewrite",
};

export const ACTION_ICONS: Record<Action, string> = {
  reply: ICON_REPLY,
  translate: ICON_TRANSLATE,
  grammar: ICON_GRAMMAR,
  rewrite: ICON_REWRITE,
};

export const ACTION_HINTS: Record<Action, string> = {
  reply: "Drafts a contextual reply — in the customer's language, yours, or both.",
  translate: "Translates the text into the language you choose. The original is kept in history.",
  grammar: "Fixes grammar and spelling in the text's own language — no translation.",
  rewrite: "Rewrites for tone, length, or clarity — optionally into another language.",
};

export const INSTRUCTION_PLACEHOLDERS: Record<Action, string> = {
  reply: "Optional: how to shape the reply (e.g. “agree, propose Friday 2pm”).",
  translate: "Optional: extra direction (e.g. “this is a support ticket — keep it formal”).",
  grammar: "Optional: extra direction (e.g. “keep the casual tone”).",
  rewrite: "Describe what to write, or how to rewrite the text. No text? Then this is your brief.",
};

// Label + placeholder for the "your text" box, by action. Shown only in
// selection / blank mode (in field mode the text is read from the field).
export const SOURCE_LABELS: Record<Action, string> = {
  reply: "Text to reply to",
  translate: "Text to translate",
  grammar: "Text to fix",
  rewrite: "Text to rewrite",
};

export const SOURCE_PLACEHOLDERS: Record<Action, string> = {
  reply: "Paste or type the message you're replying to…",
  translate: "Paste or type the customer's message to translate…",
  grammar: "Paste or type the text whose grammar you want fixed…",
  rewrite: "Paste or type the text to rewrite (or leave blank and add a brief in Options)…",
};
