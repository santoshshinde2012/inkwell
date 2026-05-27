// User-facing strings + per-action icon registry for the Assistant surface.
//
// Centralised here so each presentational component pulls only the slice it
// renders — no component owns the full label/hint mapping.

import type { Action } from "@inkwell/shared";
import type { JSX } from "react";
import { GrammarIcon, ReplyIcon, RewriteIcon, TranslateIcon } from "../icons";

export const ACTION_LABELS: Record<Action, string> = {
  reply: "Reply",
  translate: "Translate",
  grammar: "Grammar",
  rewrite: "Rewrite",
};

export const ACTION_HINTS: Record<Action, string> = {
  reply: "Drafts a contextual reply — in the customer's language, yours, or both.",
  translate: "Translates the text into the language you choose.",
  grammar: "Fixes grammar and spelling in the text's own language — no translation.",
  rewrite: "Rewrites for tone, length, or clarity — optionally into another language.",
};

export const SOURCE_PLACEHOLDERS: Record<Action, string> = {
  reply: "Paste or type the message you're replying to…",
  translate: "Paste or type the customer's message to translate…",
  grammar: "Paste or type the text whose grammar you want fixed…",
  rewrite: "Paste or type the text to rewrite (or leave blank and add a brief in Options)…",
};

export const EMPTY_TITLES: Record<Action, string> = {
  reply: "Draft your reply",
  translate: "Translate something",
  grammar: "Fix grammar & spelling",
  rewrite: "Rewrite or compose",
};

export const ACTION_ICON: Record<Action, (props: { size?: number }) => JSX.Element> = {
  reply: ReplyIcon,
  translate: TranslateIcon,
  grammar: GrammarIcon,
  rewrite: RewriteIcon,
};

// Display string for the primary keyboard shortcut. Computed once at module
// load — the platform check never changes for the lifetime of the panel.
export const KBD = navigator.platform.includes("Mac") ? "⌘↵" : "Ctrl+↵";
