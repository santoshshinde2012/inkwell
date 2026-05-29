// Sticky chat-style input bar.
//
// Layout (vertical):
//   - Chip toolbar — Options summary chip + Selection-capture chip
//     (no Mode chip; the segmented action picker above already shows
//     the current mode prominently)
//   - Input row — "+" image-OCR button · auto-growing textarea · primary
//     Send / Stop / Regenerate button
//   - Meta line — usage info or the keyboard hint
//
// Purely presentational: the parent owns every state value and callback.

import { memo, useRef, type ClipboardEvent, type JSX } from "react";
import {
  ImageIcon,
  RegenerateIcon,
  SendIcon,
  SlidersIcon,
  SparkleIcon,
  SquareIcon,
} from "../icons";
import type { ActionTheme } from "../actionTheme";
import { firstImageFrom } from "../../lib/ocr";
import { KBD } from "./constants";

export interface ChatInputBarProps {
  theme: ActionTheme;
  placeholder: string;
  inputText: string;
  onInputChange: (v: string) => void;
  /** Capture the active tab's text selection (Selection chip). */
  onCapture: () => void;
  /** A file was picked / pasted / dropped — parent should OCR it and
   *  push the recognised text into `inputText`. */
  onImage: (file: Blob) => void;
  /** Whether OCR is currently running, so we can disable the entry points
   *  rather than queueing concurrent recognitions. */
  ocrBusy: boolean;
  onOpenOptions: () => void;
  optsSummary: string;
  streaming: boolean;
  hasResult: boolean;
  meta: string;
  onGenerate: () => void;
  onCancel: () => void;
}

type PrimaryMode = "stop" | "regenerate" | "generate";

function ChatInputBarImpl({
  theme,
  placeholder,
  inputText,
  onInputChange,
  onCapture,
  onImage,
  ocrBusy,
  onOpenOptions,
  optsSummary,
  streaming,
  hasResult,
  meta,
  onGenerate,
  onCancel,
}: ChatInputBarProps): JSX.Element {
  const mode: PrimaryMode = streaming ? "stop" : hasResult ? "regenerate" : "generate";

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Pasted image — forward to the parent for OCR and swallow the event so
  // browsers don't insert "[object File]" or attempt their own insertion.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    const img = firstImageFrom(e.clipboardData?.items);
    if (!img) return;
    e.preventDefault();
    onImage(img);
  };

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    // Reset so picking the same file twice still fires onChange.
    e.target.value = "";
    if (file) onImage(file);
  };

  return (
    <footer className="border-t border-zinc-800 bg-zinc-900/60 px-3 py-2.5 backdrop-blur">
      <ChipToolbar optsSummary={optsSummary} onOpenOptions={onOpenOptions} onCapture={onCapture} />

      <div className="relative mt-2 flex items-end gap-2 rounded-2xl border border-zinc-800 bg-zinc-950 px-2 py-2 transition-colors focus-within:border-zinc-700 focus-within:bg-zinc-900">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onFilePicked}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={ocrBusy}
          title="Extract text from an image (paste, pick, or drop)"
          aria-label="Extract text from image"
          className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-zinc-300 ring-1 ring-inset ring-zinc-800 transition-colors hover:bg-zinc-800 hover:text-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {ocrBusy ? (
            <span
              aria-hidden="true"
              className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-200"
            />
          ) : (
            <ImageIcon size={15} />
          )}
        </button>
        <textarea
          dir="auto"
          rows={3}
          placeholder={placeholder}
          value={inputText}
          onChange={(e) => onInputChange(e.target.value)}
          onPaste={onPaste}
          onInput={(e) => {
            // Auto-grow up to ~10 lines (~208px). Floor at 3 rows so the
            // textarea doesn't shrink below its initial reading height
            // while a user is composing.
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = Math.min(Math.max(el.scrollHeight, 84), 224) + "px";
          }}
          className="block min-h-[84px] max-h-56 flex-1 resize-none bg-transparent px-1.5 py-2 text-[13.5px] leading-relaxed text-zinc-100 placeholder-zinc-500 caret-indigo-400 focus:outline-none"
        />
        <PrimaryButton mode={mode} theme={theme} onGenerate={onGenerate} onCancel={onCancel} />
      </div>

      <div className="mt-1.5 truncate px-1 text-center text-[10.5px] text-zinc-500" title={meta}>
        {meta}
      </div>
    </footer>
  );
}

// Memoised so unrelated re-renders in AssistantView (e.g. settings
// hydrating, OCR progress label changing) don't bounce through the
// input bar. Keystrokes still re-render — `inputText` is the prop
// being typed — but that's the expected cost.
export const ChatInputBar = memo(ChatInputBarImpl);

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function ChipToolbar({
  optsSummary,
  onOpenOptions,
  onCapture,
}: {
  optsSummary: string;
  onOpenOptions: () => void;
  onCapture: () => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onOpenOptions}
        aria-haspopup="dialog"
        title="Open options (tone, model, languages, brief)"
        className="inline-flex min-w-0 flex-1 items-center gap-1.5 rounded-full bg-zinc-900 px-2.5 py-1.5 text-[11.5px] text-zinc-300 ring-1 ring-inset ring-zinc-800 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500"
      >
        <SlidersIcon size={12} className="flex-shrink-0" />
        <span className="truncate font-medium">{optsSummary}</span>
      </button>
      <button
        type="button"
        onClick={onCapture}
        title="Pull the active tab's current text selection"
        className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full bg-zinc-900 px-2.5 py-1.5 text-[11.5px] font-medium text-zinc-300 ring-1 ring-inset ring-zinc-800 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500"
      >
        <SparkleIcon size={11} />
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
        className="relative inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-red-900/60 bg-red-950/40 text-red-200 transition-colors hover:bg-red-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-red-400"
      >
        <span
          aria-hidden="true"
          className="absolute inset-0 inline-block animate-ping rounded-xl bg-red-500/30"
        />
        <SquareIcon size={12} />
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
      className={`inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-white transition-all hover:-translate-y-px active:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40 ${theme.ctaGradient} ${theme.ctaHover} ${theme.ctaShadow}`}
    >
      {mode === "regenerate" ? <RegenerateIcon size={13} /> : <SendIcon size={16} />}
    </button>
  );
}
