// HistoryTab — one tab of the options page.
//
// Composed by ./index.ts and routed to from options/App.tsx.

import { useEffect, useMemo, useState, type JSX } from "react";
import {
  ACTIONS,
  LANGUAGE_CATALOG,
  languageLabel,
  type Action,
  type LanguageId,
} from "@inkwell/shared";
import { historyStore, type HistoryEntry } from "../../lib/history";
import { ACTION_LABELS, Card } from "../components";

export function HistoryTab(): JSX.Element {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState<Action | "all">("all");
  const [languageFilter, setLanguageFilter] = useState<string>("all");
  const [siteFilter, setSiteFilter] = useState<string>("all");

  useEffect(() => {
    void historyStore.list().then(setEntries);
  }, []);

  // Filter dropdown options, derived from whatever is actually in the log.
  const sites = useMemo(() => [...new Set((entries ?? []).map((e) => e.site))].sort(), [entries]);
  const languages = useMemo(() => {
    const set = new Set<LanguageId>();
    for (const e of entries ?? []) {
      if (e.sourceLanguage !== "auto") set.add(e.sourceLanguage);
      if (e.targetLanguage) set.add(e.targetLanguage);
    }
    return LANGUAGE_CATALOG.map((l) => l.id).filter((id) => set.has(id));
  }, [entries]);

  // If the user filtered by a value (site / language) that has since been
  // deleted, reset that filter rather than leaving them staring at a
  // phantom selection with zero matches.
  useEffect(() => {
    if (siteFilter !== "all" && !sites.includes(siteFilter)) {
      setSiteFilter("all");
    }
  }, [siteFilter, sites]);
  useEffect(() => {
    if (languageFilter !== "all" && !(languages as string[]).includes(languageFilter)) {
      setLanguageFilter("all");
    }
  }, [languageFilter, languages]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (entries ?? []).filter((e) => {
      if (actionFilter !== "all" && e.action !== actionFilter) return false;
      if (siteFilter !== "all" && e.site !== siteFilter) return false;
      if (
        languageFilter !== "all" &&
        e.sourceLanguage !== languageFilter &&
        e.targetLanguage !== languageFilter
      ) {
        return false;
      }
      if (
        q &&
        !e.inputText.toLowerCase().includes(q) &&
        !e.outputText.toLowerCase().includes(q) &&
        !e.pageTitle.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [entries, query, actionFilter, languageFilter, siteFilter]);

  const remove = async (id: string): Promise<void> => {
    await historyStore.remove(id);
    setEntries((cur) => (cur ? cur.filter((e) => e.id !== id) : cur));
  };

  const clearAll = async (): Promise<void> => {
    if (!window.confirm("Delete the entire history? This cannot be undone.")) {
      return;
    }
    await historyStore.clear();
    setEntries([]);
  };

  if (!entries) {
    return (
      <Card title="History">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
      </Card>
    );
  }

  return (
    <>
      <Card
        title="Translation & action history"
        description="Every completed translation and AI-assisted draft on this device. Stored only in your browser — never sent to a server."
      >
        <div className="flex flex-wrap gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search text or page title…"
            className="min-w-[180px] flex-1 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-950 dark:placeholder-zinc-500"
          />
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value as Action | "all")}
            aria-label="Filter by action"
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="all">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABELS[a]}
              </option>
            ))}
          </select>
          <select
            value={languageFilter}
            onChange={(e) => setLanguageFilter(e.target.value)}
            aria-label="Filter by language"
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="all">All languages</option>
            {languages.map((id) => (
              <option key={id} value={id}>
                {languageLabel(id)}
              </option>
            ))}
          </select>
          {sites.length > 1 && (
            <select
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
              aria-label="Filter by conversation"
              className="max-w-[180px] rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950"
            >
              <option value="all">All conversations</option>
              {sites.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {filtered.length} of {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </p>
          {entries.length > 0 && (
            <button
              type="button"
              onClick={() => void clearAll()}
              className="text-xs text-zinc-500 underline hover:text-red-600 dark:hover:text-red-400"
            >
              Clear all history
            </button>
          )}
        </div>
      </Card>

      {filtered.length === 0 ? (
        <section className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-sm italic text-zinc-400 dark:text-zinc-500">
            {entries.length === 0
              ? "No history yet. Completed translations and drafts will appear here."
              : "No entries match the current filters."}
          </p>
        </section>
      ) : (
        filtered.map((e) => <HistoryCard key={e.id} entry={e} onDelete={() => void remove(e.id)} />)
      )}
    </>
  );
}

function HistoryCard({
  entry,
  onDelete,
}: {
  entry: HistoryEntry;
  onDelete: () => void;
}): JSX.Element {
  const [copied, setCopied] = useState(false);

  const source = entry.sourceLanguage === "auto" ? "Auto" : languageLabel(entry.sourceLanguage);
  const target = entry.bilingual
    ? `${source} + ${entry.targetLanguage ? languageLabel(entry.targetLanguage) : "—"}`
    : entry.targetLanguage
      ? languageLabel(entry.targetLanguage)
      : source;

  const copyOutput = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(entry.outputText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — the text stays selectable on the card.
    }
  };

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
          {ACTION_LABELS[entry.action]}
        </span>
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {source} → {target}
        </span>
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
          {new Date(entry.createdAt).toLocaleString()}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void copyOutput()}
          className="text-xs text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400"
        >
          {copied ? "Copied" : "Copy output"}
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete entry"
          className="text-xs text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
        >
          Delete
        </button>
      </header>
      <p className="mt-1 truncate text-[11px] text-zinc-400 dark:text-zinc-500">
        {entry.site}
        {entry.pageTitle ? ` · ${entry.pageTitle}` : ""}
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
            Input
          </div>
          <p
            dir="auto"
            className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md bg-zinc-50 p-2 text-xs text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
          >
            {entry.inputText || "—"}
          </p>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
            Output
          </div>
          <p
            dir="auto"
            className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md bg-zinc-50 p-2 text-xs text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
          >
            {entry.outputText || "—"}
          </p>
        </div>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// About tab
// -----------------------------------------------------------------------------
