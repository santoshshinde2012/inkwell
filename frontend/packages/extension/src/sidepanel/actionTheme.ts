// Per-action color tokens. Each Inkwell action (reply / translate /
// grammar / rewrite) gets its own visual identity — the same color
// carries through the picker tab, the result card glow, and the primary
// Generate CTA. Lets the user identify the current mode at a glance.
//
// IMPORTANT: Tailwind 3 scans source files at build time and only ships
// classes it can see literally. That's why every class string is written
// out in full instead of being assembled from a template like
// `bg-${color}-500/15` — those forms would be invisible to the scanner
// and the styles would silently disappear in production.

import type { Action } from "@inkwell/shared";

export interface ActionTheme {
  /** Active-tab fill on the segmented picker. */
  tabActive: string;
  /** A subtle ring on the active tab. */
  tabRing: string;
  /** Border + soft glow for the streaming/ready result card. */
  resultBorder: string;
  resultGlow: string;
  /** Background gradient for the primary Generate / Regenerate CTA. */
  ctaGradient: string;
  ctaHover: string;
  /** Shadow color hint under the primary CTA. */
  ctaShadow: string;
  /** Soft icon-only accent dot used on the empty-result avatar. */
  accentIcon: string;
  /** Streaming caret color (used on the trailing pulse character). */
  caret: string;
  /** Solid bg class for the thinking-dot indicator. */
  dotBg: string;
}

export const ACTION_THEMES: Record<Action, ActionTheme> = {
  reply: {
    tabActive: "bg-gradient-to-b from-indigo-500/25 to-indigo-500/10 text-indigo-100",
    tabRing: "ring-1 ring-inset ring-indigo-400/30 shadow-sm shadow-indigo-900/40",
    resultBorder: "border-indigo-900/60",
    resultGlow:
      "bg-gradient-to-b from-indigo-950/40 to-zinc-900/60 shadow-inner shadow-indigo-950/40",
    ctaGradient: "bg-gradient-to-r from-indigo-500 to-violet-500",
    ctaHover: "hover:from-indigo-400 hover:to-violet-400",
    ctaShadow: "shadow-lg shadow-indigo-950/40",
    accentIcon: "text-indigo-300",
    caret: "after:bg-indigo-400",
    dotBg: "bg-indigo-400",
  },
  translate: {
    tabActive: "bg-gradient-to-b from-sky-500/25 to-sky-500/10 text-sky-100",
    tabRing: "ring-1 ring-inset ring-sky-400/30 shadow-sm shadow-sky-900/40",
    resultBorder: "border-sky-900/60",
    resultGlow: "bg-gradient-to-b from-sky-950/40 to-zinc-900/60 shadow-inner shadow-sky-950/40",
    ctaGradient: "bg-gradient-to-r from-sky-500 to-cyan-500",
    ctaHover: "hover:from-sky-400 hover:to-cyan-400",
    ctaShadow: "shadow-lg shadow-sky-950/40",
    accentIcon: "text-sky-300",
    caret: "after:bg-sky-400",
    dotBg: "bg-sky-400",
  },
  grammar: {
    tabActive: "bg-gradient-to-b from-emerald-500/25 to-emerald-500/10 text-emerald-100",
    tabRing: "ring-1 ring-inset ring-emerald-400/30 shadow-sm shadow-emerald-900/40",
    resultBorder: "border-emerald-900/60",
    resultGlow:
      "bg-gradient-to-b from-emerald-950/40 to-zinc-900/60 shadow-inner shadow-emerald-950/40",
    ctaGradient: "bg-gradient-to-r from-emerald-500 to-teal-500",
    ctaHover: "hover:from-emerald-400 hover:to-teal-400",
    ctaShadow: "shadow-lg shadow-emerald-950/40",
    accentIcon: "text-emerald-300",
    caret: "after:bg-emerald-400",
    dotBg: "bg-emerald-400",
  },
  rewrite: {
    tabActive: "bg-gradient-to-b from-amber-500/25 to-amber-500/10 text-amber-100",
    tabRing: "ring-1 ring-inset ring-amber-400/30 shadow-sm shadow-amber-900/40",
    resultBorder: "border-amber-900/60",
    resultGlow:
      "bg-gradient-to-b from-amber-950/40 to-zinc-900/60 shadow-inner shadow-amber-950/40",
    ctaGradient: "bg-gradient-to-r from-amber-500 to-orange-500",
    ctaHover: "hover:from-amber-400 hover:to-orange-400",
    ctaShadow: "shadow-lg shadow-amber-950/40",
    accentIcon: "text-amber-300",
    caret: "after:bg-amber-400",
    dotBg: "bg-amber-400",
  },
  summarize: {
    tabActive: "bg-gradient-to-b from-purple-500/25 to-purple-500/10 text-purple-100",
    tabRing: "ring-1 ring-inset ring-purple-400/30 shadow-sm shadow-purple-900/40",
    resultBorder: "border-purple-900/60",
    resultGlow:
      "bg-gradient-to-b from-purple-950/40 to-zinc-900/60 shadow-inner shadow-purple-950/40",
    ctaGradient: "bg-gradient-to-r from-purple-500 to-fuchsia-500",
    ctaHover: "hover:from-purple-400 hover:to-fuchsia-400",
    ctaShadow: "shadow-lg shadow-purple-950/40",
    accentIcon: "text-purple-300",
    caret: "after:bg-purple-400",
    dotBg: "bg-purple-400",
  },
  explain: {
    tabActive: "bg-gradient-to-b from-rose-500/25 to-rose-500/10 text-rose-100",
    tabRing: "ring-1 ring-inset ring-rose-400/30 shadow-sm shadow-rose-900/40",
    resultBorder: "border-rose-900/60",
    resultGlow: "bg-gradient-to-b from-rose-950/40 to-zinc-900/60 shadow-inner shadow-rose-950/40",
    ctaGradient: "bg-gradient-to-r from-rose-500 to-pink-500",
    ctaHover: "hover:from-rose-400 hover:to-pink-400",
    ctaShadow: "shadow-lg shadow-rose-950/40",
    accentIcon: "text-rose-300",
    caret: "after:bg-rose-400",
    dotBg: "bg-rose-400",
  },
};
