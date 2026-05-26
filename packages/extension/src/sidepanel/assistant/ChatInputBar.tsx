// Sticky chat-style input bar.
//
// Layout:
//   - Chip toolbar (current mode chip, Options chip, Selection chip)
//   - Textarea row with a "+" capture button on the left and the primary
//     Send / Stop / Regenerate button on the right
//   - Status line (meta) showing usage info or the keyboard hint
//
// Pure presentational — the parent owns every state value and callback.

import type { JSX } from "react";
import type { Action } from "@inkwell/shared";
import {
  PlusIcon,
  RegenerateIcon,
  SendIcon,
  SlidersIcon,
  SparkleIcon,
  SquareIcon,
} from "../icons";
import type { ActionTheme } from "../actionTheme";
import { ACTION_ICON, ACTION_LABELS, KBD } from "./constants";

export interface ChatInputBarProps {
  action: Action;
  theme: ActionTheme;
  placeholder: string;
  inputText: string;
  onInputChange: (v: string) => void;
  onCapture: () => void;
  onOpenOptions: () => void;
  optsSummary: string;
  streaming: boolean;
  hasResult: boolean;
  meta: string;
  onGenerate: () => void;
  onCancel: () => void;
}

type PrimaryMode = "stop" | "regenerate" | "generate";

export function ChatInputBar({
  action,
  theme,
  placeholder,
  inputText,
  onInputChange,
  onCapture,
  onOpenOptions,
  optsSummary,
  streaming,
  hasResult,
  meta,
  onGenerate,
  onCancel,
}: ChatInputBarProps): JSX.Element {
  const mode: PrimaryMode = streaming
    ? "stop"
    : hasResult
      ? "regenerate"
      : "generate";

  return (
    <footer className="border-t border-zinc-800 bg-zinc-900/60 px-2.5 py-2 backdrop-blur">
      <ChipToolbar
        action={action}
        theme={theme}
        optsSummary={optsSummary}
        onOpenOptions={onOpenOptions}
        onCapture={onCapture}
      />

      <div className="relative mt-1.5 flex items-end gap-1.5 rounded-2xl border border-zinc-800 bg-zinc-950 px-1.5 py-1.5 transition-colors focus-within:border-zinc-700 focus-within:bg-zinc-900">
        <button
          type="button"
          onClick={onCapture}
          title="Use the active tab's current selection"
          aria-label="Use page selection"
          className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-zinc-300 ring-1 ring-inset ring-zinc-800 transition-colors hover:bg-zinc-800 hover:text-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500"
        >
          <PlusIcon size={14} />
        </button>
        <textarea
          dir="auto"
          rows={3}
          placeholder={placeholder}
          value={inputText}
          onChange={(e) => onInputChange(e.target.value)}
          onInput={(e) => {
            // Auto-grow up to ~10 lines (~208px). Floor at 3 rows so the
            // textarea doesn't shrink below its initial reading height
            // while a user is composing.
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height =
              Math.min(Math.max(el.scrollHeight, 76), 208) + "px";
          }}
          className="block min-h-[76px] max-h-52 flex-1 resize-none bg-transparent px-1 py-2 text-[13px] leading-relaxed text-zinc-100 placeholder-zinc-500 caret-indigo-400 focus:outline-none"
        />
        <PrimaryButton
          mode={mode}
          theme={theme}
          onGenerate={onGenerate}
          onCancel={onCancel}
        />
      </div>

      <div
        className="mt-1 truncate text-center text-[10px] text-zinc-500"
        title={meta}
      >
        {meta}
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function ChipToolbar({
  action,
  theme,
  optsSummary,
  onOpenOptions,
  onCapture,
}: {
  action: Action;
  theme: ActionTheme;
  optsSummary: string;
  onOpenOptions: () => void;
  onCapture: () => void;
}): JSX.Element {
  const ActionIcon = ACTION_ICON[action];
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <span
        title={`Mode: ${ACTION_LABELS[action]}`}
        className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium ring-1 ring-inset ${theme.tabActive} ${theme.tabRing}`}
      >
        <ActionIcon size={11} />
        {ACTION_LABELS[action]}
      </span>
      <button
        type="button"
        onClick={onOpenOptions}
        aria-haspopup="dialog"
        title="Open options"
        className="inline-flex max-w-[200px] flex-shrink-0 items-center gap-1.5 rounded-full bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 ring-1 ring-inset ring-zinc-800 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500"
      >
        <SlidersIcon size={11} />
        <span className="truncate font-medium">{optsSummary}</span>
      </button>
      <button
        type="button"
        onClick={onCapture}
        title="Use the active tab's current selection"
        className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full bg-zinc-900 px-2 py-1 text-[11px] font-medium text-zinc-300 ring-1 ring-inset ring-zinc-800 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500"
      >
        <SparkleIcon size={10} />
        Selection
      </button>
    </div>
  );
}

function PrimaryButton({
  mode,
  theme,
  onGenerate,
  onCancel,
}: {
  mode: PrimaryMode;
  theme: ActionTheme;
  onGenerate: () => void;
  onCancel: () => void;
}): JSX.Element {
  if (mode === "stop") {
    return (
      <button
        type="button"
        onClick={onCancel}
        title="Stop generation"
        aria-label="Stop generation"
        className="relative inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-red-900/60 bg-red-950/40 text-red-200 transition-colors hover:bg-red-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-red-400"
      >
        <span
          aria-hidden="true"
          className="absolute inset-0 inline-block animate-ping rounded-xl bg-red-500/30"
        />
        <SquareIcon size={11} />
      </button>
    );
  }
  const label = mode === "regenerate" ? "Regenerate" : "Send";
  const title = mode === "regenerate" ? `Regenerate (${KBD})` : `Send (${KBD})`;
  return (
    <button
      type="button"
      onClick={onGenerate}
      title={title}
      aria-label={label}
      className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-white transition-transform hover:-translate-y-px active:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40 ${theme.ctaGradient} ${theme.ctaHover} ${theme.ctaShadow}`}
    >
      {mode === "regenerate" ? <RegenerateIcon size={12} /> : <SendIcon size={14} />}
    </button>
  );
}
