// History view — list of past Inkwell actions, mobile-app feel.
//
// Every successful action (Reply / Translate / Grammar / Rewrite) recorded
// by either the popover or the Side Panel surfaces here. The list is
// grouped by day, searchable, and each row expands inline to show the
// input + output side by side. Copy and delete live on each row.

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type Action,
  type LanguageId,
  languageLabel,
} from "@inkwell/shared";
import {
  ENTRIES_WARN_AT,
  historyStore,
  MAX_ENTRIES as HISTORY_MAX_ENTRIES,
  STORAGE_KEY as HISTORY_STORAGE_KEY,
  type HistoryEntry,
} from "../lib/history";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  GrammarIcon,
  HistoryIcon,
  MenuIcon,
  ReplyIcon,
  RewriteIcon,
  SearchIcon,
  TranslateIcon,
  TrashIcon,
  XIcon,
} from "./icons";

export function HistoryView({
  onOpenDrawer,
  onJumpToAssistant,
}: {
  onOpenDrawer: () => void;
  onJumpToAssistant: () => void;
}): JSX.Element {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  // Hoisted out of `HistoryRow` so only a single ConfirmDialog ever lives
  // in the DOM regardless of how many rows are visible. Stores the id of
  // the entry the user has asked to delete (null = no prompt open).
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // Undo buffer — entries the user has just deleted, kept around for
  // ~6 seconds while the toast is on screen.
  const [undoState, setUndoState] = useState<{
    entries: HistoryEntry[];
    label: string;
  } | null>(null);
  const undoTimerRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const next = await historyStore.list();
    setEntries(next);
  }, []);

  useEffect(() => {
    void refresh();
    // Auto-refresh when history is mutated elsewhere — by the Assistant
    // view in this same panel, or by the in-page popover on another tab.
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: chrome.storage.AreaName,
    ): void => {
      if (area !== "local") return;
      if (HISTORY_STORAGE_KEY in changes) void refresh();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [refresh]);

  const scheduleUndoClear = useCallback((): void => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
    }
    undoTimerRef.current = window.setTimeout(() => {
      setUndoState(null);
      undoTimerRef.current = null;
    }, 6000);
  }, []);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current !== null) {
        window.clearTimeout(undoTimerRef.current);
      }
    };
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      const removed = entries?.find((e) => e.id === id) ?? null;
      await historyStore.remove(id);
      setEntries((prev) => (prev ? prev.filter((e) => e.id !== id) : prev));
      setOpenId((cur) => (cur === id ? null : cur));
      setPendingDeleteId((cur) => (cur === id ? null : cur));
      if (removed) {
        setUndoState({ entries: [removed], label: "Entry deleted" });
        scheduleUndoClear();
      }
    },
    [entries, scheduleUndoClear],
  );

  const handleClearAll = useCallback(async () => {
    const snapshot = entries ?? [];
    await historyStore.clear();
    setEntries([]);
    setOpenId(null);
    setPendingDeleteId(null);
    setConfirmClear(false);
    if (snapshot.length > 0) {
      setUndoState({
        entries: snapshot,
        label: `Cleared ${snapshot.length} ${snapshot.length === 1 ? "entry" : "entries"}`,
      });
      scheduleUndoClear();
    }
  }, [entries, scheduleUndoClear]);

  const handleUndo = useCallback(async () => {
    if (!undoState) return;
    await historyStore.restore(undoState.entries);
    // The storage onChanged listener will re-fetch and update `entries`,
    // so we just dismiss the toast here.
    setUndoState(null);
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  }, [undoState]);

  const filtered = useMemo(() => {
    if (!entries) return null;
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => {
      return (
        e.inputText.toLowerCase().includes(q) ||
        e.outputText.toLowerCase().includes(q) ||
        (e.pageTitle ?? "").toLowerCase().includes(q) ||
        e.action.includes(q)
      );
    });
  }, [entries, query]);

  const grouped = useMemo(() => groupByDay(filtered ?? []), [filtered]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-zinc-800 px-2 py-2.5">
        <button
          type="button"
          onClick={onOpenDrawer}
          title="Menu (⌘B)"
          aria-label="Open menu"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500"
        >
          <MenuIcon size={17} />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <div className="truncate text-[14px] font-semibold tracking-tight text-zinc-50">
            History
          </div>
          <div className="truncate text-[10.5px] text-zinc-500">
            Stored only on this device — newest 250
          </div>
        </div>
        {entries && entries.length > 0 ? (
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            title="Clear all history"
            aria-label="Clear all history"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-red-950/40 hover:text-red-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-red-400"
          >
            <TrashIcon size={14} />
          </button>
        ) : (
          <span className="inline-block h-9 w-9" aria-hidden="true" />
        )}
      </header>

      {entries && entries.length > 0 && (
        <div className="space-y-2 border-b border-zinc-800/70 px-3 py-2">
          <SearchField value={query} onChange={setQuery} />
          {entries.length >= ENTRIES_WARN_AT && (
            <QuotaNotice
              count={entries.length}
              max={HISTORY_MAX_ENTRIES}
            />
          )}
        </div>
      )}

      <main className="flex-1 overflow-y-auto px-3 py-3">
        {entries === null ? (
          <LoadingState />
        ) : entries.length === 0 ? (
          <EmptyState onJump={onJumpToAssistant} />
        ) : filtered && filtered.length === 0 ? (
          <NoMatchState query={query} onClear={() => setQuery("")} />
        ) : (
          <div className="space-y-4">
            {grouped.map((group) => (
              <DayGroup
                key={group.label}
                label={group.label}
                entries={group.entries}
                openId={openId}
                onToggle={(id) =>
                  setOpenId((cur) => (cur === id ? null : id))
                }
                onAskDelete={setPendingDeleteId}
              />
            ))}
          </div>
        )}
      </main>

      {confirmClear && (
        <ConfirmDialog
          title="Clear all history?"
          body="Removes every recorded action on this device. Tap Undo within 6 seconds to restore."
          confirmLabel="Clear all"
          danger
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => void handleClearAll()}
        />
      )}
      {pendingDeleteId && (
        <ConfirmDialog
          title="Delete this entry?"
          body="Removes this single record from your history. Tap Undo to restore."
          confirmLabel="Delete"
          danger
          onCancel={() => setPendingDeleteId(null)}
          onConfirm={() => void handleDelete(pendingDeleteId)}
        />
      )}
      {undoState && (
        <UndoToast
          label={undoState.label}
          onUndo={() => void handleUndo()}
          onDismiss={() => setUndoState(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function SearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <label className="relative block">
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500">
        <SearchIcon size={13} />
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search input, output, or page…"
        className="block w-full rounded-xl border border-zinc-800 bg-zinc-950 py-2 pl-8 pr-8 text-[12.5px] text-zinc-100 placeholder-zinc-500 caret-indigo-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          <XIcon size={11} />
        </button>
      )}
    </label>
  );
}

function DayGroup({
  label,
  entries,
  openId,
  onToggle,
  onAskDelete,
}: {
  label: string;
  entries: HistoryEntry[];
  openId: string | null;
  onToggle: (id: string) => void;
  onAskDelete: (id: string) => void;
}): JSX.Element {
  return (
    <section>
      <h3 className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </h3>
      <ul className="space-y-1.5">
        {entries.map((e) => (
          <HistoryRow
            key={e.id}
            entry={e}
            expanded={openId === e.id}
            onToggle={() => onToggle(e.id)}
            onAskDelete={() => onAskDelete(e.id)}
          />
        ))}
      </ul>
    </section>
  );
}

function HistoryRow({
  entry,
  expanded,
  onToggle,
  onAskDelete,
}: {
  entry: HistoryEntry;
  expanded: boolean;
  onToggle: () => void;
  onAskDelete: () => void;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  const copyOutput = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(entry.outputText);
      setCopied(true);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        copyTimerRef.current = null;
      }, 1500);
    } catch {
      /* clipboard blocked — non-fatal */
    }
  }, [entry.outputText]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  return (
    <li className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60 transition-colors hover:border-zinc-700">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-zinc-800/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-500"
      >
        <ActionBadge action={entry.action} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[12.5px] font-medium text-zinc-100">
              {actionLabel(entry.action)}
            </span>
            <LanguagePill
              source={entry.sourceLanguage}
              target={entry.targetLanguage}
              bilingual={entry.bilingual}
            />
          </div>
          <div className="mt-0.5 line-clamp-1 text-[11.5px] leading-snug text-zinc-400">
            {entry.outputText || entry.inputText || "(empty)"}
          </div>
          <div className="mt-0.5 truncate text-[10px] text-zinc-500">
            {formatTime(entry.createdAt)}
            {entry.pageTitle && (
              <>
                <span className="px-1 text-zinc-700">·</span>
                <span>{entry.pageTitle}</span>
              </>
            )}
          </div>
        </div>
        <ChevronDownIcon
          size={14}
          className={`mt-1 text-zinc-500 transition-transform duration-200 ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-zinc-800 bg-zinc-950/40 px-3 py-3">
          <DetailBlock label="Input" text={entry.inputText} />
          <DetailBlock label="Output" text={entry.outputText} />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void copyOutput()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-[11.5px] font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
            >
              {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
              {copied ? "Copied" : "Copy output"}
            </button>
            <button
              type="button"
              onClick={onAskDelete}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-[11.5px] font-medium text-zinc-300 transition-colors hover:border-red-900/60 hover:bg-red-950/30 hover:text-red-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400"
            >
              <TrashIcon size={12} />
              Delete
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function DetailBlock({
  label,
  text,
}: {
  label: string;
  text: string;
}): JSX.Element {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-2 text-[12px] leading-relaxed text-zinc-200">
        {text || "(empty)"}
      </div>
    </div>
  );
}

function ActionBadge({ action }: { action: Action }): JSX.Element {
  const Icon =
    action === "reply"
      ? ReplyIcon
      : action === "translate"
        ? TranslateIcon
        : action === "grammar"
          ? GrammarIcon
          : RewriteIcon;
  const tone =
    action === "reply"
      ? "bg-indigo-500/15 text-indigo-200"
      : action === "translate"
        ? "bg-sky-500/15 text-sky-200"
        : action === "grammar"
          ? "bg-emerald-500/15 text-emerald-200"
          : "bg-amber-500/15 text-amber-200";
  return (
    <span
      className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${tone}`}
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
}): JSX.Element | null {
  const src = source === "auto" ? "Auto" : languageLabel(source);
  if (!target) {
    return (
      <span className="rounded-full border border-zinc-700/80 bg-zinc-900 px-1.5 py-0.5 text-[9.5px] font-medium text-zinc-400">
        {src}
      </span>
    );
  }
  const tgt = bilingual ? `${languageLabel(target)} + src` : languageLabel(target);
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-zinc-700/80 bg-zinc-900 px-1.5 py-0.5 text-[9.5px] font-medium text-zinc-400">
      {src}
      <ArrowRightIcon size={9} />
      {tgt}
    </span>
  );
}

function EmptyState({ onJump }: { onJump: () => void }): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-900 text-zinc-500 ring-1 ring-zinc-800">
        <HistoryIcon size={22} />
      </span>
      <div>
        <div className="text-[13px] font-semibold text-zinc-100">
          No history yet
        </div>
        <p className="mt-1 text-[11.5px] leading-relaxed text-zinc-500">
          Replies, translations, fixes and rewrites you generate will show up
          here. Everything stays on this device.
        </p>
      </div>
      <button
        type="button"
        onClick={onJump}
        className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-3.5 py-2 text-[12px] font-semibold text-white shadow-lg shadow-indigo-950/40 transition-colors hover:from-indigo-400 hover:to-violet-400"
      >
        Open the assistant
        <ArrowRightIcon size={13} />
      </button>
    </div>
  );
}

function NoMatchState({
  query,
  onClear,
}: {
  query: string;
  onClear: () => void;
}): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-900 text-zinc-500 ring-1 ring-zinc-800">
        <SearchIcon size={18} />
      </span>
      <div>
        <div className="text-[12.5px] font-semibold text-zinc-100">
          No matches for “{query}”
        </div>
        <p className="mt-1 text-[11.5px] text-zinc-500">
          Try a shorter query or clear the filter.
        </p>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-[11.5px] font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800"
      >
        Clear search
      </button>
    </div>
  );
}

function LoadingState(): JSX.Element {
  return (
    <ul className="space-y-1.5">
      {[0, 1, 2, 3].map((i) => (
        <li
          key={i}
          className="h-16 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900/40"
        />
      ))}
    </ul>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  // Auto-focus Cancel — for destructive prompts the safe default is to back
  // out, not to confirm. Also wire Escape to close.
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className="absolute inset-0 z-30 flex items-end justify-center bg-zinc-950/60 p-3 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div id={titleId} className="text-[13.5px] font-semibold text-zinc-100">
          {title}
        </div>
        <p id={bodyId} className="mt-1.5 text-[12px] leading-relaxed text-zinc-400">
          {body}
        </p>
        <div className="mt-4 flex gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-[12px] font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 rounded-xl px-3 py-2 text-[12px] font-semibold text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
              danger
                ? "bg-red-500 hover:bg-red-400 focus-visible:outline-red-400"
                : "bg-indigo-500 hover:bg-indigo-400 focus-visible:outline-indigo-300"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quota notice — inline warning surfaced once the user is within 50 records
// of the on-device cap. Lets them know that further actions silently drop
// the oldest entries.
// ---------------------------------------------------------------------------

function QuotaNotice({ count, max }: { count: number; max: number }): JSX.Element {
  const atCap = count >= max;
  return (
    <div
      role="status"
      className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[10.5px] leading-snug ${
        atCap
          ? "border-amber-900/60 bg-amber-950/30 text-amber-200"
          : "border-zinc-800 bg-zinc-900/60 text-zinc-400"
      }`}
    >
      <span
        aria-hidden="true"
        className={`mt-px inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full ${
          atCap ? "bg-amber-500/20 text-amber-200" : "bg-zinc-800 text-zinc-400"
        }`}
      >
        <svg
          width="9"
          height="9"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4" />
          <path d="M12 16h.01" />
        </svg>
      </span>
      <span>
        <span className="font-semibold">
          {count} / {max}
        </span>{" "}
        {atCap
          ? "— at the on-device limit. Each new action drops the oldest entry."
          : "— close to the on-device limit. Older entries are dropped first."}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Undo toast — bottom-anchored, auto-dismisses on a 6s timer in the parent
// ---------------------------------------------------------------------------

function UndoToast({
  label,
  onUndo,
  onDismiss,
}: {
  label: string;
  onUndo: () => void;
  onDismiss: () => void;
}): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 bottom-3 z-40 flex justify-center px-3"
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-zinc-100 px-3.5 py-1.5 text-[12px] font-medium text-zinc-900 shadow-lg shadow-black/40">
        <span className="inline-flex items-center gap-1.5">
          <TrashIcon size={12} />
          {label}
        </span>
        <button
          type="button"
          onClick={onUndo}
          className="rounded-full bg-indigo-500 px-2.5 py-0.5 text-[11px] font-semibold text-white transition-colors hover:bg-indigo-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="rounded-full p-0.5 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-900"
        >
          <XIcon size={11} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function actionLabel(a: Action): string {
  switch (a) {
    case "reply":
      return "Reply";
    case "translate":
      return "Translate";
    case "grammar":
      return "Grammar";
    case "rewrite":
      return "Rewrite";
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const isSameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (isSameDay(d, today)) return "Today";
  if (isSameDay(d, yesterday)) return "Yesterday";
  // Older than a week shows the absolute date
  const diffDays = (today.getTime() - d.getTime()) / (24 * 3600 * 1000);
  if (diffDays < 7) {
    return d.toLocaleDateString(undefined, { weekday: "long" });
  }
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year:
      d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function groupByDay(
  entries: HistoryEntry[],
): { label: string; entries: HistoryEntry[] }[] {
  const out: { label: string; entries: HistoryEntry[] }[] = [];
  let currentLabel = "";
  for (const e of entries) {
    const label = dayLabel(e.createdAt);
    if (label !== currentLabel) {
      out.push({ label, entries: [e] });
      currentLabel = label;
    } else {
      out[out.length - 1]!.entries.push(e);
    }
  }
  return out;
}
