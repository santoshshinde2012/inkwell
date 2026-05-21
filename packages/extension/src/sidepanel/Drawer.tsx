// Slide-out drawer for the Side Panel.
//
// Triggered by the hamburger button in each view's top bar. Slides in
// from the left as an overlay, with a dimmed backdrop covering the
// remaining strip. Tap the backdrop, hit Escape, or pick a nav item to
// dismiss.
//
// Designed to feel restrained — one profile card, three nav items, one
// CTA, one footer. Anything that previously routed to the options page
// (Help, Open in tab, Default backend) is collapsed into the single
// "Open advanced settings" CTA so the drawer reads at a glance.
//
// A11y: role=dialog + aria-modal, Escape closes, body scroll locked,
// focus is sent to the close button on open.

import {
  useEffect,
  useId,
  useRef,
} from "react";
import type { BackendStatus } from "../lib/backend";
import type { SidePanelView } from "../lib/ui-state";
import {
  DropIcon,
  ExternalLinkIcon,
  GearIcon,
  HistoryIcon,
  SparkleIcon,
  XIcon,
} from "./icons";

const PKG_VERSION = "1.1.0";

export interface DrawerProps {
  open: boolean;
  current: SidePanelView;
  backendStatus: BackendStatus;
  displayName: string;
  historyCount: number;
  onClose: () => void;
  onChange: (v: SidePanelView) => void;
  onOpenFullSettings: () => void;
}

export function Drawer({
  open,
  current,
  backendStatus,
  displayName,
  historyCount,
  onClose,
  onChange,
  onOpenFullSettings,
}: DrawerProps): JSX.Element | null {
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const initial =
    (displayName || "I").trim().charAt(0).toUpperCase() || "I";

  const navigate = (v: SidePanelView): void => {
    onChange(v);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
      className="absolute inset-0 z-50"
      style={{ animation: "drawer-fade 140ms ease-out" }}
    >
      <style>{DRAWER_KEYFRAMES}</style>
      <div
        className="absolute inset-y-0 left-0 flex w-[88%] max-w-[320px] flex-col border-r border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: "drawer-slide 200ms ease-out" }}
      >
        {/* Brand mark lives in the Footer at the bottom; this top strip is
            just the close affordance so the X stays where users expect. */}
        <header
          id={titleId}
          className="flex items-center justify-end px-3 pt-3"
        >
          <h2 className="sr-only">Inkwell menu</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            title="Close (Esc)"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500"
          >
            <XIcon size={14} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 pb-4 pt-2">
          <ProfileCard
            initial={initial}
            displayName={displayName}
            backendStatus={backendStatus}
          />

          <nav aria-label="Primary" className="mt-5 space-y-0.5">
            <NavItem
              label="Assistant"
              icon={<SparkleIcon size={14} />}
              active={current === "assistant"}
              onClick={() => navigate("assistant")}
            />
            <NavItem
              label="History"
              icon={<HistoryIcon size={14} />}
              active={current === "history"}
              onClick={() => navigate("history")}
              badge={historyCount}
            />
            <NavItem
              label="Settings"
              icon={<GearIcon size={14} />}
              active={current === "settings"}
              onClick={() => navigate("settings")}
            />
          </nav>

          <BrandCTA
            onClick={() => {
              onOpenFullSettings();
              onClose();
            }}
          />
        </div>

        <Footer />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile card — avatar + name + a single status row
// ---------------------------------------------------------------------------

function ProfileCard({
  initial,
  displayName,
  backendStatus,
}: {
  initial: string;
  displayName: string;
  backendStatus: BackendStatus;
}): JSX.Element {
  const dot =
    backendStatus === "ok"
      ? "bg-emerald-400"
      : backendStatus === "down"
        ? "bg-red-400"
        : "bg-amber-300";
  const statusLabel =
    backendStatus === "ok"
      ? "Backend online"
      : backendStatus === "down"
        ? "Backend offline"
        : "Connecting…";
  const statusColor =
    backendStatus === "ok"
      ? "text-emerald-300"
      : backendStatus === "down"
        ? "text-red-300"
        : "text-amber-300";
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3">
      <span
        aria-hidden="true"
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-[15px] font-semibold text-white shadow-md shadow-indigo-950/40"
      >
        {initial}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold tracking-tight text-zinc-50">
          {displayName.trim() || "Add your name"}
        </div>
        <div
          className={`mt-0.5 inline-flex items-center gap-1.5 text-[11.5px] font-medium ${statusColor}`}
        >
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dot}`} />
          {statusLabel}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nav item — flat row, optional badge, active state via subtle bg + ring
// ---------------------------------------------------------------------------

function NavItem({
  label,
  icon,
  active,
  onClick,
  badge,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  badge?: number;
}): JSX.Element {
  const showBadge = typeof badge === "number" && badge > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 ${
        active
          ? "bg-indigo-500/12 text-indigo-100"
          : "text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-50"
      }`}
    >
      <span
        className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${
          active
            ? "bg-indigo-500/25 text-indigo-200"
            : "bg-zinc-900 text-zinc-400 group-hover:text-zinc-200"
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {showBadge && (
        <span
          className={`inline-flex h-5 min-w-[22px] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold ${
            active
              ? "bg-indigo-500/30 text-indigo-100"
              : "bg-zinc-800 text-zinc-300 group-hover:bg-zinc-700"
          }`}
        >
          {badge! > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Brand CTA — single button to the full options page, on-brand gradient
// ---------------------------------------------------------------------------

function BrandCTA({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 px-4 py-2.5 text-[12.5px] font-semibold text-white shadow-md shadow-indigo-950/40 transition-transform hover:-translate-y-px hover:shadow-indigo-900/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
    >
      Open advanced settings
      <ExternalLinkIcon size={13} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Footer — compact one-line "Inkwell · vX.Y.Z"
// ---------------------------------------------------------------------------

function Footer(): JSX.Element {
  return (
    <footer className="flex items-center justify-center gap-2 border-t border-zinc-800/70 px-4 py-3 text-[11px] text-zinc-500">
      <span
        aria-hidden="true"
        className="flex h-4 w-4 items-center justify-center rounded bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white"
      >
        <DropIcon size={9} />
      </span>
      <span className="font-medium text-zinc-400">Inkwell</span>
      <span aria-hidden="true" className="text-zinc-700">
        ·
      </span>
      <span>v{PKG_VERSION}</span>
    </footer>
  );
}

const DRAWER_KEYFRAMES = `
@keyframes drawer-fade {
  from { background-color: rgba(0, 0, 0, 0); }
  to { background-color: rgba(9, 9, 11, 0.7); }
}
@keyframes drawer-slide {
  from { transform: translateX(-100%); }
  to { transform: translateX(0); }
}
`;
