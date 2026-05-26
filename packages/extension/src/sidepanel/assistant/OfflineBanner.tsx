// Surfaced inline when the backend probe fails. Gives the user a single
// direct link into Settings → Backend so they can resolve the issue without
// leaving the panel.

import type { JSX } from "react";
import { AlertTriangleIcon, ArrowRightIcon } from "../icons";

export interface OfflineBannerProps {
  onOpenSettings: () => void;
}

export function OfflineBanner({ onOpenSettings }: OfflineBannerProps): JSX.Element {
  return (
    <div
      role="alert"
      className="mx-3 mt-3 flex items-start gap-2.5 rounded-2xl border border-red-900/60 bg-red-950/30 px-3 py-2.5 text-red-100 shadow-sm shadow-red-950/40"
    >
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-red-500/15 text-red-300"
      >
        <AlertTriangleIcon size={13} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-semibold text-red-100">
          Backend is offline
        </div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-red-200/80">
          Generations will fail until it's reachable. Check the URL and API
          key, or switch to your own backend.
        </p>
        <button
          type="button"
          onClick={onOpenSettings}
          className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-red-900/60 bg-red-950/40 px-2 py-1 text-[10.5px] font-medium text-red-100 transition-colors hover:bg-red-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-red-400"
        >
          Open backend settings
          <ArrowRightIcon size={11} />
        </button>
      </div>
    </div>
  );
}
