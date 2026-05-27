// History row + expanded detail view.
//
// Collapsed row design:
//   - Small action badge (color-coded by mode) on the left
//   - Title line: action name · language pair pill
//   - Output preview (2 lines, line-clamped) — what the user is most
//     likely scanning for
//   - Meta line: time · page title
//   - Always-visible Copy button on the right (no need to expand for a
//     quick paste). On hover the row gets a subtle highlight.
//   - Chevron at the far right to expand the full Input + Output view
//
// Expanded view:
//   - Input block → arrow → Output block, stacked vertically
//   - A subtle footer with the source URL + Delete button
//
// Purely presentational; the parent owns expand state and delete intent.

import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { type Action, type LanguageId, languageLabel } from "@inkwell/shared";
import type { HistoryEntry } from "../../lib/history";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  ExternalLinkIcon,
  GrammarIcon,
  ReplyIcon,
  RewriteIcon,
  TranslateIcon,
  TrashIcon,
} from "../icons";
import { ACTION_LABEL, ACTION_TONE, formatTime } from "./helpers";

const ACTION_ICON: Record<Action, (p: { size?: number }) => JSX.Element> = {
  reply: ReplyIcon,
  translate: TranslateIcon,
  grammar: GrammarIcon,
  rewrite: RewriteIcon,
};

export interface RowProps {
  entry: HistoryEntry;
  expanded: boolean;
  onToggle: () => void;
  onAskDelete: () => void;
}

export function Row({ entry, expanded, onToggle, onAskDelete }: RowProps): JSX.Element {
  return (
    <li className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60 transition-colors hover:border-zinc-700">
      <CollapsedHeader entry={entry} expanded={expanded} onToggle={onToggle} />
      {expanded && <ExpandedDetail entry={entry} onAskDelete={onAskDelete} />}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Collapsed header — the always-visible row
// ---------------------------------------------------------------------------

function CollapsedHeader({
  entry,
  expanded,
  onToggle,
}: {
  entry: HistoryEntry;
  expanded: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <div className="group flex items-start gap-2 px-3 py-2.5">
      <ActionBadge action={entry.action} />
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="min-w-0 flex-1 cursor-pointer text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-500"
      >
        <div className="flex items-center gap-1.5">
          <span className="text-[12.5px] font-semibold text-zinc-100">
            {ACTION_LABEL[entry.action]}
          </span>
          <LanguagePill
            source={entry.sourceLanguage}
            target={entry.targetLanguage}
            bilingual={entry.bilingual}
          />
        </div>
        <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-zinc-300">
          {entry.outputText || entry.inputText || "(empty)"}
        </p>
        <div className="mt-1 flex items-center gap-1.5 truncate text-[10px] text-zinc-500">
          <span className="tabular-nums">{formatTime(entry.createdAt)}</span>
          {entry.pageTitle && (
            <>
              <span aria-hidden="true" className="text-zinc-700">
                ·
              </span>
              <span className="truncate">{entry.pageTitle}</span>
            </>
          )}
        </div>
      </button>
      <div className="flex flex-shrink-0 items-center gap-0.5">
        <RowCopyButton text={entry.outputText} />
        <button
          type="button"
          onClick={onToggle}
          aria-label={expanded ? "Collapse" : "Expand"}
          title={expanded ? "Collapse" : "Expand"}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
        >
          <ChevronDownIcon
            size={13}
            className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline copy button — surfaces on every row so the most common action
// (copy the output) doesn't require an expand-then-click sequence.
// ---------------------------------------------------------------------------

function RowCopyButton({ text }: { text: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  const onClick = useCallback(async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        setCopied(false);
        timerRef.current = null;
      }, 1500);
    } catch {
      /* clipboard blocked — non-fatal */
    }
  }, [text]);
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);
  const disabled = !text;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void onClick();
      }}
      disabled={disabled}
      title={copied ? "Copied" : "Copy output"}
      aria-label={copied ? "Copied" : "Copy output"}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 ${
        copied
          ? "bg-emerald-500/15 text-emerald-200"
          : disabled
            ? "cursor-not-allowed text-zinc-700"
            : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
      }`}
    >
      {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Expanded detail — Input → Output, then a footer row
// ---------------------------------------------------------------------------

function ExpandedDetail({
  entry,
  onAskDelete,
}: {
  entry: HistoryEntry;
  onAskDelete: () => void;
}): JSX.Element {
  return (
    <div className="space-y-3 border-t border-zinc-800 bg-zinc-950/40 px-3 py-3">
      <DetailBlock label="Input" text={entry.inputText} />
      <div className="flex items-center justify-center text-zinc-700" aria-hidden="true">
        <ArrowRightIcon size={11} className="rotate-90" />
      </div>
      <DetailBlock label="Output" text={entry.outputText} />

      {entry.conversationUrl && entry.conversationUrl !== "manual" && (
        <SourceLine url={entry.conversationUrl} title={entry.pageTitle} />
      )}

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={onAskDelete}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11.5px] font-medium text-zinc-300 transition-colors hover:border-red-900/60 hover:bg-red-950/30 hover:text-red-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400"
        >
          <TrashIcon size={12} />
          Delete entry
        </button>
      </div>
    </div>
  );
}

function DetailBlock({ label, text }: { label: string; text: string }): JSX.Element {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div
        dir="auto"
        className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-2 text-[12px] leading-relaxed text-zinc-200"
      >
        {text || "(empty)"}
      </div>
    </div>
  );
}

function SourceLine({ url, title }: { url: string; title: string }): JSX.Element {
  let displayHost = url;
  try {
    displayHost = new URL(url).host || url;
  } catch {
    /* not a parseable URL — show the raw string */
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${title || displayHost} in a new tab`}
      className="group flex items-center gap-1.5 truncate rounded-lg px-1.5 py-1 text-[10.5px] text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
    >
      <ExternalLinkIcon size={10} aria-hidden="true" />
      <span className="truncate">{title || displayHost}</span>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function ActionBadge({ action }: { action: Action }): JSX.Element {
  const Icon = ACTION_ICON[action];
  const tone = ACTION_TONE[action];
  return (
    <span
      aria-hidden="true"
      className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${tone.bg} ${tone.text} ${tone.ring}`}
    >
      <Icon size={13} />
    </span>
  );
}

function LanguagePill({
  source,
  target,
  bilingual,
}: {
  source: LanguageId | "auto";
  target: LanguageId | null;
  bilingual: boolean;
}): JSX.Element {
  const src = source === "auto" ? "Auto" : languageLabel(source);
  if (!target) {
    return (
      <span className="rounded-full bg-zinc-900 px-1.5 py-0.5 text-[9.5px] font-medium text-zinc-400 ring-1 ring-inset ring-zinc-800">
        {src}
      </span>
    );
  }
  const tgt = bilingual ? `${languageLabel(target)} + src` : languageLabel(target);
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-900 px-1.5 py-0.5 text-[9.5px] font-medium text-zinc-400 ring-1 ring-inset ring-zinc-800">
      {src}
      <ArrowRightIcon size={9} />
      {tgt}
    </span>
  );
}
