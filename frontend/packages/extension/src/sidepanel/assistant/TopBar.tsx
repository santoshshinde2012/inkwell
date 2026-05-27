// Top bar above the Assistant view. Single-line layout:
//   hamburger · brand mark · "Inkwell" wordmark · status dot · history shortcut
//
// The status dot replaces the previous two-line "Connected to backend"
// subtitle — semantic color + tooltip carries the same information in
// a fraction of the vertical space.

import type { JSX } from "react";
import type { BackendStatus } from "../../lib/backend";
import { DropIcon, HistoryIcon, MenuIcon } from "../icons";

export interface AssistantTopBarProps {
  backend: { status: BackendStatus; url: string };
  onOpenDrawer: () => void;
  onOpenHistory: () => void;
}

const STATUS_DOT: Record<BackendStatus, string> = {
  ok: "bg-emerald-400",
  down: "bg-red-400",
  checking: "bg-amber-300 animate-pulse",
};

const STATUS_LABEL: Record<BackendStatus, string> = {
  ok: "Backend connected",
  down: "Backend offline — check Settings",
  checking: "Checking backend…",
};

export function AssistantTopBar({
  backend,
  onOpenDrawer,
  onOpenHistory,
}: AssistantTopBarProps): JSX.Element {
  const statusTitle = backend.url
    ? `${STATUS_LABEL[backend.status]} · ${backend.url}`
    : STATUS_LABEL[backend.status];

  return (
    <header className="flex items-center gap-1 border-b border-zinc-800 bg-zinc-950/60 px-2 py-2.5 backdrop-blur">
      <IconButton onClick={onOpenDrawer} title="Menu (⌘B)" ariaLabel="Open menu">
        <MenuIcon size={17} />
      </IconButton>

      <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
        <span
          aria-hidden="true"
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-sm shadow-indigo-950/40"
        >
          <DropIcon size={12} />
        </span>
        <span className="truncate text-[14px] font-semibold tracking-tight text-zinc-50">
          Inkwell
        </span>
        <span
          aria-label={STATUS_LABEL[backend.status]}
          title={statusTitle}
          className="inline-flex flex-shrink-0 items-center"
        >
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${STATUS_DOT[backend.status]}`}
          />
        </span>
      </div>

      <IconButton onClick={onOpenHistory} title="Open history" ariaLabel="Open history">
        <HistoryIcon size={16} />
      </IconButton>
    </header>
  );
}

function IconButton({
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
      className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500"
    >
      {children}
    </button>
  );
}
