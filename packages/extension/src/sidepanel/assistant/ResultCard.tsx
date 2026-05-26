// Result card — the main output surface, sized to dominate the panel's
// vertical space. Renders four states:
//   - empty:     no preview yet (small per-action affordance)
//   - streaming: tokens arriving, animated thinking dots / caret
//   - ready:     final output, with Copy + Regenerate actions
//   - error:     red surface with optional "Reload side panel" recovery
//
// The component is purely presentational: parent owns preview state and
// every action callback.

import type { JSX } from "react";
import type { Action } from "@inkwell/shared";
import {
  CheckIcon,
  CopyIcon,
  RegenerateIcon,
  SparkleIcon,
  XIcon,
} from "../icons";
import type { ActionTheme } from "../actionTheme";
import { ACTION_HINTS, ACTION_LABELS } from "./constants";

export interface ResultCardProps {
  action: Action;
  theme: ActionTheme;
  preview: string;
  streaming: boolean;
  error: string | null;
  errorAction: "refresh" | null;
  canCopy: boolean;
  copied: boolean;
  onCopy: () => void;
  onRegenerate: () => void;
}

type ResultState = "empty" | "streaming" | "ready" | "error";

const containerClass = (state: ResultState, theme: ActionTheme): string => {
  switch (state) {
    case "empty":
      return "border-dashed border-zinc-800 bg-zinc-950/40 text-zinc-500";
    case "streaming":
      return `${theme.resultBorder} ${theme.resultGlow} text-zinc-100`;
    case "error":
      return "border-red-900/60 bg-red-950/20 text-red-200";
    case "ready":
      return `${theme.resultBorder} bg-zinc-900 text-zinc-100 shadow-sm shadow-black/20`;
  }
};

export function ResultCard({
  action,
  theme,
  preview,
  streaming,
  error,
  errorAction,
  canCopy,
  copied,
  onCopy,
  onRegenerate,
}: ResultCardProps): JSX.Element {
  const state: ResultState = error
    ? "error"
    : streaming
      ? "streaming"
      : preview
        ? "ready"
        : "empty";

  return (
    <section className="flex min-h-[160px] flex-1 flex-col">
      <div className="mb-1.5 flex items-center justify-between px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Result
        </span>
        <div className="flex items-center gap-1">
          {state === "ready" && (
            <ToolbarButton
              onClick={onRegenerate}
              title="Regenerate with the same options"
              ariaLabel="Regenerate"
            >
              <RegenerateIcon size={11} />
              Regenerate
            </ToolbarButton>
          )}
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
      </div>
      <div
        aria-live="polite"
        className={`flex-1 overflow-y-auto rounded-2xl border p-3 text-[13px] leading-relaxed transition-colors ${containerClass(state, theme)}`}
      >
        {state === "error" ? (
          <ErrorBody error={error!} errorAction={errorAction} />
        ) : preview ? (
          <PreviewText preview={preview} streaming={streaming} theme={theme} />
        ) : streaming ? (
          <ThinkingDots theme={theme} />
        ) : (
          <EmptyResult action={action} theme={theme} />
        )}
      </div>
    </section>
  );
}

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
      className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10.5px] font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
    >
      {children}
    </button>
  );
}

function ErrorBody({
  error,
  errorAction,
}: {
  error: string;
  errorAction: "refresh" | null;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <XIcon size={14} />
        <span>{error}</span>
      </div>
      {errorAction === "refresh" && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="self-start rounded-lg border border-red-900/60 bg-red-950/40 px-2.5 py-1 text-[11px] font-semibold text-red-100 transition-colors hover:bg-red-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
        >
          Reload side panel
        </button>
      )}
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

function EmptyResult({
  action,
  theme,
}: {
  action: Action;
  theme: ActionTheme;
}): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-4 text-center">
      <span
        className={`flex h-10 w-10 items-center justify-center rounded-2xl bg-zinc-900/80 ring-1 ring-zinc-800 ${theme.accentIcon}`}
      >
        <SparkleIcon size={16} />
      </span>
      <div>
        <div className="text-[13px] font-semibold text-zinc-100">
          {ACTION_LABELS[action]}
        </div>
        <p className="mx-auto mt-1 max-w-[28ch] text-[11.5px] leading-relaxed text-zinc-500">
          {ACTION_HINTS[action]}
        </p>
      </div>
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
