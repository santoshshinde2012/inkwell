// Slide-out drawer for the Side Panel.
//
// Triggered by the hamburger button in each view's top bar. Slides in
// from the left as an overlay, covering most of the panel width with a
// dimmed backdrop covering the remaining strip. Tap the backdrop, hit
// Escape, or pick a nav item to dismiss.
//
// Sections (top → bottom):
//   • Profile card — initial avatar, display name, history + working-lang badges
//   • Backend row  — "Default backend" with chevron → opens the full options page
//   • Nav list     — Assistant / History / Settings, with active state + badges
//   • Gradient CTA — "Open full settings" with brand gradient
//   • Branding     — logo + "Inkwell vX.Y.Z" at the bottom
//
// A11y: role=dialog + aria-modal, Escape closes, body scroll locked,
// focus is sent to the close button on open.

import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";
import {
  languageDisplayName,
  type LanguageId,
} from "@inkwell/shared";
import type { BackendStatus } from "../lib/backend";
import type { SidePanelView } from "../lib/ui-state";
import {
  ChevronRightIcon,
  DropIcon,
  ExternalLinkIcon,
  GearIcon,
  GiftIcon,
  HelpIcon,
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
  workingLanguage: LanguageId;
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
  workingLanguage,
  historyCount,
  onClose,
  onChange,
  onOpenFullSettings,
}: DrawerProps): JSX.Element | null {
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  // Lock body scroll + autofocus close button + Escape to dismiss.
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

  // Render nothing when closed — keeps DOM weight off the main view and
  // means the slide-in plays fresh every time it opens.
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
        <header
          id={titleId}
          className="flex items-center justify-between px-3 pt-3"
        >
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-md shadow-indigo-900/40"
            >
              <DropIcon size={14} />
            </span>
            <span className="text-[13.5px] font-semibold tracking-tight text-zinc-50">
              Inkwell
            </span>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            title="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500"
          >
            <XIcon size={14} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-3 pb-3 pt-3">
          <ProfileCard
            initial={initial}
            displayName={displayName}
            historyCount={historyCount}
            workingLanguage={workingLanguage}
            backendStatus={backendStatus}
            onOpenFullSettings={onOpenFullSettings}
          />

          <Section>
            <NavItem
              label="Assistant"
              icon={<SparkleIcon size={14} />}
              active={current === "assistant"}
              onClick={() => navigate("assistant")}
            />
            <NavItem
              label="History"
              icon={<HistoryIcon size={16} />}
              active={current === "history"}
              onClick={() => navigate("history")}
              badge={historyCount}
            />
            <NavItem
              label="Settings"
              icon={<GearIcon size={16} />}
              active={current === "settings"}
              onClick={() => navigate("settings")}
              chevron
            />
          </Section>

          <Section>
            <NavItem
              label="Help & Privacy"
              icon={<HelpIcon size={16} />}
              chevron
              onClick={() => {
                void chrome.tabs.create({
                  url: chrome.runtime.getURL("src/options/index.html#about"),
                });
                onClose();
              }}
            />
            <NavItem
              label="Open in tab"
              icon={<ExternalLinkIcon size={16} />}
              chevron
              onClick={() => {
                onOpenFullSettings();
                onClose();
              }}
            />
          </Section>

          <GradientCTA
            onClick={() => {
              onOpenFullSettings();
              onClose();
            }}
          />
        </div>

        <Branding />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function ProfileCard({
  initial,
  displayName,
  historyCount,
  workingLanguage,
  backendStatus,
  onOpenFullSettings,
}: {
  initial: string;
  displayName: string;
  historyCount: number;
  workingLanguage: LanguageId;
  backendStatus: BackendStatus;
  onOpenFullSettings: () => void;
}): JSX.Element {
  const dot =
    backendStatus === "ok"
      ? "bg-emerald-400"
      : backendStatus === "down"
        ? "bg-red-400"
        : "bg-amber-300";
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-[15px] font-semibold text-white shadow-md shadow-indigo-950/40"
        >
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold tracking-tight text-zinc-50">
            {displayName.trim() || "Add your name"}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone="indigo" icon={<SparkleIcon size={9} />}>
              {historyCount}
            </Badge>
            <Badge tone="zinc">{languageDisplayName(workingLanguage)}</Badge>
            <Badge tone={backendStatus === "ok" ? "emerald" : "red"}>
              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dot}`} />
              {backendStatus === "ok"
                ? "Online"
                : backendStatus === "down"
                  ? "Offline"
                  : "Connecting"}
            </Badge>
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onOpenFullSettings}
        className="mt-3 inline-flex w-full items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-left text-[12px] text-zinc-200 transition-colors hover:border-zinc-700 hover:bg-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500"
      >
        <span className="inline-flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-zinc-800 text-zinc-400">
            <GearIcon size={11} />
          </span>
          <span className="font-medium">Default backend</span>
        </span>
        <ChevronRightIcon size={12} className="text-zinc-500" />
      </button>
    </div>
  );
}

function Badge({
  tone,
  icon,
  children,
}: {
  tone: "indigo" | "emerald" | "red" | "zinc";
  icon?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  const map: Record<typeof tone, string> = {
    indigo: "bg-indigo-500/15 text-indigo-200 ring-indigo-500/30",
    emerald: "bg-emerald-500/15 text-emerald-200 ring-emerald-500/30",
    red: "bg-red-500/15 text-red-200 ring-red-500/30",
    zinc: "bg-zinc-800 text-zinc-300 ring-zinc-700/60",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${map[tone]}`}
    >
      {icon}
      {children}
    </span>
  );
}

function Section({ children }: { children: ReactNode }): JSX.Element {
  return <div className="mt-3 space-y-0.5">{children}</div>;
}

function NavItem({
  label,
  icon,
  active = false,
  onClick,
  badge,
  chevron = false,
}: {
  label: string;
  icon: ReactNode;
  active?: boolean;
  onClick: () => void;
  badge?: number;
  chevron?: boolean;
}): JSX.Element {
  const showBadge = typeof badge === "number" && badge > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`group flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left text-[13px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 ${
        active
          ? "bg-indigo-500/12 text-indigo-100 ring-1 ring-inset ring-indigo-500/30"
          : "text-zinc-300 hover:bg-zinc-800/70 hover:text-zinc-50"
      }`}
    >
      <span
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${
          active
            ? "bg-indigo-500/20 text-indigo-200"
            : "bg-zinc-900 text-zinc-400 group-hover:text-zinc-200"
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {showBadge && (
        <span className="inline-flex h-5 min-w-[22px] items-center justify-center rounded-full bg-zinc-800 px-1.5 text-[10px] font-semibold text-zinc-300 group-hover:bg-zinc-700">
          {badge! > 99 ? "99+" : badge}
        </span>
      )}
      {chevron && (
        <ChevronRightIcon size={13} className="text-zinc-500" />
      )}
    </button>
  );
}

function GradientCTA({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-fuchsia-500 via-pink-500 to-orange-400 px-4 py-2.5 text-[13px] font-semibold text-white shadow-lg shadow-pink-950/40 transition-transform hover:-translate-y-px hover:shadow-pink-900/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-300"
    >
      <GiftIcon size={14} />
      Open full settings
      <SparkleIcon size={12} />
    </button>
  );
}

function Branding(): JSX.Element {
  return (
    <footer className="flex flex-col items-center gap-1 border-t border-zinc-800/70 px-3 py-3">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-md shadow-indigo-900/40"
      >
        <DropIcon size={15} />
      </span>
      <span className="text-[12px] font-semibold tracking-tight text-zinc-200">
        Inkwell
      </span>
      <span className="text-[10px] text-zinc-500">v{PKG_VERSION}</span>
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
