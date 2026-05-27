// History view — searchable, filterable record of every Inkwell action.
//
// Layout (top → bottom):
//   1. Slim TopBar with entry count chip + clear-all action
//   2. Sticky FilterBar — action chips + search + (conditional) quota notice
//   3. Scrollable list grouped by day, each day's label pinned as a
//      secondary sticky header below the FilterBar
//   4. Bottom-anchored UndoToast + modal ConfirmDialog overlays
//
// All persistence lives in `historyStore` (chrome.storage.local). The
// shell here owns only ephemeral UI state: which row is expanded, what
// the user typed into search, which filter chip is selected, and the
// deletion / undo toggles.
//
// View pieces live in ./history/ — see that directory's index for what
// each file owns.
//
// `storage.onChanged` keeps the list in sync across surfaces: any add /
// remove from the Assistant view or the in-page popover (in another tab)
// reflects here without a manual refresh.
//
// The clear-all and per-row delete flows always pair with a 6-second
// undo toast — the recovery window is documented in the confirm dialog
// bodies so the user knows the destructive action is reversible.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { type Action } from "@inkwell/shared";
import {
  ENTRIES_WARN_AT,
  historyStore,
  MAX_ENTRIES as HISTORY_MAX_ENTRIES,
  STORAGE_KEY as HISTORY_STORAGE_KEY,
  type HistoryEntry,
} from "../../lib/history";
import { useStorageChange } from "../../lib/useStorageChange";
import { HistoryTopBar } from "./TopBar";
import { FilterBar } from "./FilterBar";
import { DayGroup } from "./DayGroup";
import { EmptyState, LoadingState, NoMatchState } from "./states";
import { ConfirmDialog, UndoToast } from "./Dialogs";
import { ACTION_LABEL, groupByDay } from "./helpers";

const UNDO_TIMEOUT_MS = 6000;
// Pixel offset for sticky day headers — matches the rendered height of
// the FilterBar that pins above them in the same scroll container.
// Recomputed lazily; a layout effect would be overkill for a single value
// that only shifts when the quota notice appears (which is rare and only
// at-cap).
const DAY_STICKY_OFFSET = 92;
const DAY_STICKY_OFFSET_WITH_QUOTA = 124;

export function HistoryView({
  onOpenDrawer,
  onJumpToAssistant,
}: {
  onOpenDrawer: () => void;
  onJumpToAssistant: () => void;
}): JSX.Element {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [selectedAction, setSelectedAction] = useState<Action | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
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
  }, [refresh]);

  // Live sync — covers cross-tab mutations from the popover or another
  // copy of the side panel.
  useStorageChange([HISTORY_STORAGE_KEY], () => {
    void refresh();
  });

  const scheduleUndoClear = useCallback((): void => {
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = window.setTimeout(() => {
      setUndoState(null);
      undoTimerRef.current = null;
    }, UNDO_TIMEOUT_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    };
  }, []);

  // -------------------------------------------------------------------------
  // Destructive actions (always paired with an undo toast)
  // -------------------------------------------------------------------------
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
    // The storage onChanged listener will re-fetch, so we just dismiss
    // the toast here.
    setUndoState(null);
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  }, [undoState]);

  // -------------------------------------------------------------------------
  // Derived: filter + group
  // -------------------------------------------------------------------------
  const counts = useMemo(() => {
    const base: Record<Action, number> = { reply: 0, translate: 0, grammar: 0, rewrite: 0 };
    for (const e of entries ?? []) base[e.action] += 1;
    return base;
  }, [entries]);

  const filtered = useMemo(() => {
    if (!entries) return null;
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (selectedAction !== "all" && e.action !== selectedAction) return false;
      if (!q) return true;
      return (
        e.inputText.toLowerCase().includes(q) ||
        e.outputText.toLowerCase().includes(q) ||
        (e.pageTitle ?? "").toLowerCase().includes(q) ||
        e.action.includes(q)
      );
    });
  }, [entries, query, selectedAction]);

  const grouped = useMemo(() => groupByDay(filtered ?? []), [filtered]);

  const clearFilters = useCallback(() => {
    setQuery("");
    setSelectedAction("all");
  }, []);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const total = entries?.length ?? 0;
  const showFilterBar = !!entries && entries.length > 0;
  const stickyOffset = total >= ENTRIES_WARN_AT ? DAY_STICKY_OFFSET_WITH_QUOTA : DAY_STICKY_OFFSET;
  const activeFilterLabel = selectedAction === "all" ? null : ACTION_LABEL[selectedAction];

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <HistoryTopBar
        count={total}
        onOpenDrawer={onOpenDrawer}
        onClear={() => setConfirmClear(true)}
      />

      <main className="relative flex-1 overflow-y-auto px-3 pb-3">
        {showFilterBar && (
          <FilterBar
            counts={counts}
            total={total}
            selected={selectedAction}
            onSelect={setSelectedAction}
            query={query}
            onQueryChange={setQuery}
            quotaCount={total}
            quotaMax={HISTORY_MAX_ENTRIES}
            quotaWarnAt={ENTRIES_WARN_AT}
          />
        )}

        <div className="pt-3">
          {entries === null ? (
            <LoadingState />
          ) : entries.length === 0 ? (
            <EmptyState onJump={onJumpToAssistant} />
          ) : filtered && filtered.length === 0 ? (
            <NoMatchState
              query={query.trim()}
              filterLabel={activeFilterLabel}
              onClear={clearFilters}
            />
          ) : (
            <div className="space-y-4">
              {grouped.map((group) => (
                <DayGroup
                  key={group.label}
                  label={group.label}
                  entries={group.entries}
                  openId={openId}
                  stickyTopPx={stickyOffset}
                  onToggle={(id) => setOpenId((cur) => (cur === id ? null : id))}
                  onAskDelete={setPendingDeleteId}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {confirmClear && (
        <ConfirmDialog
          title="Clear all history?"
          body={`Removes every recorded action (${total}) from this device. You'll have ${UNDO_TIMEOUT_MS / 1000}s to undo.`}
          confirmLabel="Clear all"
          danger
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => void handleClearAll()}
        />
      )}
      {pendingDeleteId && (
        <ConfirmDialog
          title="Delete this entry?"
          body={`Removes this single record from your history. You'll have ${UNDO_TIMEOUT_MS / 1000}s to undo.`}
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
