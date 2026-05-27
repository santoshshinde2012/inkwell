// Slim red banner used for transient inline failures — OCR errors,
// clipboard capture failures, validation messages. Sits ABOVE the
// result area rather than replacing it, so the user keeps seeing the
// empty-state affordances (or whatever preview was already there)
// instead of staring at a wall of red.
//
// The banner is purely presentational; the parent owns the dismiss
// callback. A `refresh` action is offered for the one error class
// users can only recover from with a panel reload — orphaned content
// scripts after an extension update.

import type { JSX } from "react";
import { XIcon, AlertTriangleIcon } from "../icons";

export interface ErrorBannerProps {
  message: string;
  action: "refresh" | null;
  onDismiss: () => void;
}

export function ErrorBanner({ message, action, onDismiss }: ErrorBannerProps): JSX.Element {
  return (
    <div
      role="alert"
      className="mb-2 flex items-start gap-2 rounded-xl border border-red-900/70 bg-red-950/40 px-3 py-2 text-[12px] leading-relaxed text-red-100 shadow-sm shadow-red-950/30"
    >
      <AlertTriangleIcon
        size={14}
        className="mt-0.5 flex-shrink-0 text-red-300"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="break-words">{message}</p>
        {action === "refresh" && (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-1.5 inline-flex items-center rounded-lg border border-red-800/80 bg-red-900/40 px-2 py-0.5 text-[11px] font-semibold text-red-50 transition-colors hover:bg-red-800/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
          >
            Reload side panel
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        title="Dismiss"
        aria-label="Dismiss error"
        className="ml-1 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md text-red-200/80 transition-colors hover:bg-red-900/40 hover:text-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-red-400"
      >
        <XIcon size={12} />
      </button>
    </div>
  );
}
