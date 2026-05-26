// Top bar shown above the Assistant view. Mirrors the layout used by the
// History and Settings views so the user always has a hamburger on the
// left and a context-specific shortcut on the right — here, the history
// shortcut.

import type { JSX } from "react";
import type { BackendStatus } from "../../lib/backend";
import { HistoryIcon, MenuIcon } from "../icons";

export interface AssistantTopBarProps {
  backend: { status: BackendStatus; url: string };
  onOpenDrawer: () => void;
  onOpenHistory: () => void;
}

const STATUS_LABEL: Record<BackendStatus, string> = {
  ok: "Connected to backend",
  down: "Backend offline",
  checking: "Connecting…",
};

const STATUS_TONE: Record<BackendStatus, string> = {
  ok: "text-zinc-500",
  down: "text-red-300",
  checking: "text-zinc-500",
};

export function AssistantTopBar({
  backend,
  onOpenDrawer,
  onOpenHistory,
}: AssistantTopBarProps): JSX.Element {
  return (
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
          Assistant
        </div>
        <div
          className={`truncate text-[10.5px] ${STATUS_TONE[backend.status]}`}
          title={backend.url || undefined}
        >
          {STATUS_LABEL[backend.status]}
        </div>
      </div>
      <button
        type="button"
        onClick={onOpenHistory}
        title="Open history"
        aria-label="Open history"
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500"
      >
        <HistoryIcon size={16} />
      </button>
    </header>
  );
}
