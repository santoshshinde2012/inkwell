// Result card — the main output surface, sized to dominate the panel's
// vertical space. Two states:
//   - streaming: tokens arriving, animated thinking dots / live caret
//   - ready:     final output, with Copy + Regenerate actions and a
//                Refine bar (quick chips + free-text follow-up) that
//                iterates on the draft via conversational refinement
//
// Errors render as a banner above this card (in the parent); the empty
// state is the HeroEmptyState, not this component. The parent gates
// on `hasContent` before mounting us, so we never render an empty body.
//
// Actions live as small floating chips in the top-right of the card,
// surfaced only when a complete result is on screen.

import { memo, useState } from "react";
import type { JSX } from "react";
import { CheckIcon, CopyIcon, RegenerateIcon, SendIcon } from "../icons";
import type { ActionTheme } from "../actionTheme";

export interface ResultCardProps {
  theme: ActionTheme;
  preview: string;
  streaming: boolean;
  canCopy: boolean;
  copied: boolean;
  onCopy: () => void;
  onRegenerate: () => void;
  /** Re-run the same action with a short follow-up instruction, replaying
   *  the conversation so the model revises this draft. Omit to hide the
   *  refine bar. */
  onRefine?: (instruction: string) => void;
}

// Quick one-tap refinements. The label is compact for the chip; the
// instruction is the full directive sent to the model.
const REFINE_CHIPS: ReadonlyArray<{ label: string; instruction: string }> = [
  { label: "Shorter", instruction: "Make it shorter." },
  { label: "Longer", instruction: "Make it more detailed." },
  { label: "Formal", instruction: "Make it more formal." },
  { label: "Friendlier", instruction: "Make it warmer and friendlier." },
  { label: "Simpler", instruction: "Simplify the language." },
];

function ResultCardImpl({
  theme,
  preview,
  streaming,
  canCopy,
  copied,
  onCopy,
  onRegenerate,
  onRefine,
}: ResultCardProps): JSX.Element {
  const ready = !streaming && !!preview;
  const containerClass = streaming
    ? `${theme.resultBorder} ${theme.resultGlow} text-zinc-100`
    : `${theme.resultBorder} bg-zinc-900 text-zinc-100 shadow-sm shadow-black/20`;

  return (
    <section className="relative flex min-h-[180px] flex-1 flex-col">
      {ready && (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
          <ToolbarButton
            onClick={onRegenerate}
            title="Regenerate with the same options"
            ariaLabel="Regenerate"
          >
            <RegenerateIcon size={11} />
            Regenerate
          </ToolbarButton>
          {canCopy && (
            <ToolbarButton
              onClick={onCopy}
              title="Copy the result to the clipboard"
              ariaLabel={copied ? "Copied" : "Copy result"}
            >
              {copied ? <CheckIcon size={11} /> : <CopyIcon size={11} />}
              {copied ? "Copied" : "Copy"}
            </ToolbarButton>
          )}
        </div>
      )}
      <div
        aria-live="polite"
        className={`flex-1 overflow-y-auto rounded-2xl border p-4 text-[13.5px] leading-relaxed transition-colors ${containerClass} ${ready ? "pt-12" : ""}`}
      >
        {preview ? (
          <PreviewText preview={preview} streaming={streaming} theme={theme} />
        ) : (
          <ThinkingDots theme={theme} />
        )}
      </div>
      {ready && onRefine && <RefineBar theme={theme} onRefine={onRefine} />}
    </section>
  );
}

// Memoised so unrelated state changes in AssistantView (typing in the
// textarea, instruction field edits, options-sheet toggles) don't
// force the result region to re-render. Re-renders still happen on
// every token while streaming because `preview` is a primitive that
// changes — that's intentional; the transition wrapper in
// `useStreamingResult` already deprioritises those repaints so they
// can't block typing.
export const ResultCard = memo(ResultCardImpl);

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function ToolbarButton({
  onClick,
  title,
  ariaLabel,
  children,
}: {
  onClick: () => void;
  title: string;
  ariaLabel: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900/95 px-2 py-1 text-[10.5px] font-medium text-zinc-200 shadow-sm shadow-black/30 backdrop-blur transition-colors hover:border-zinc-600 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
    >
      {children}
    </button>
  );
}

function RefineBar({
  theme,
  onRefine,
}: {
  theme: ActionTheme;
  onRefine: (instruction: string) => void;
}): JSX.Element {
  const [text, setText] = useState("");
  const submit = (): void => {
    const v = text.trim();
    if (!v) return;
    onRefine(v);
    setText("");
  };
  return (
    <div className="mt-2 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-2">
      <div className="mb-1.5 flex flex-wrap gap-1">
        {REFINE_CHIPS.map((chip) => (
          <button
            key={chip.label}
            type="button"
            onClick={() => onRefine(chip.instruction)}
            title={chip.instruction}
            className={`rounded-full border border-zinc-700 bg-zinc-800/60 px-2.5 py-1 text-[10.5px] font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100 hover:${theme.accentIcon} focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500`}
          >
            {chip.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Refine the result — e.g. “add a deadline”…"
          aria-label="Refine instruction"
          className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-950/60 px-2.5 py-1.5 text-[12px] text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          title="Refine (Enter)"
          aria-label="Refine"
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white transition-all disabled:cursor-not-allowed disabled:opacity-40 ${theme.ctaGradient} ${theme.ctaHover} ${theme.ctaShadow}`}
        >
          <SendIcon size={14} />
        </button>
      </div>
    </div>
  );
}

function PreviewText({
  preview,
  streaming,
  theme,
}: {
  preview: string;
  streaming: boolean;
  theme: ActionTheme;
}): JSX.Element {
  return (
    <div
      dir="auto"
      className={`whitespace-pre-wrap break-words ${
        streaming
          ? `after:ml-0.5 after:inline-block after:h-[1em] after:w-px after:animate-pulse after:align-[-2px] ${theme.caret}`
          : ""
      }`}
    >
      {preview}
    </div>
  );
}

function ThinkingDots({ theme }: { theme: ActionTheme }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 text-zinc-400">
      Thinking
      <span className="inline-flex gap-0.5">
        <Dot delay={0} theme={theme} />
        <Dot delay={150} theme={theme} />
        <Dot delay={300} theme={theme} />
      </span>
    </span>
  );
}

function Dot({ delay, theme }: { delay: number; theme: ActionTheme }): JSX.Element {
  return (
    <span
      className={`inline-block h-1 w-1 animate-bounce rounded-full ${theme.dotBg}`}
      style={{ animationDelay: `${delay}ms`, animationDuration: "1.1s" }}
    />
  );
}
