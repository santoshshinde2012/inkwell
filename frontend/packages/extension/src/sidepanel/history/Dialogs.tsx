// Modal + toast pieces for the History view.
//
//   - ConfirmDialog: bottom-sheet style confirmation for destructive
//     actions (delete one / clear all). Auto-focuses Cancel (safe
//     default for destructive prompts) and closes on Escape.
//   - UndoToast: pill at the bottom with an Undo button. The parent
//     manages the 6-second visibility timer.

import { useEffect, useId, useRef } from "react";
import type { JSX } from "react";
import { TrashIcon, XIcon } from "../icons";

export interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
}: ConfirmDialogProps): JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

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

export interface UndoToastProps {
  label: string;
  onUndo: () => void;
  onDismiss: () => void;
}

export function UndoToast({ label, onUndo, onDismiss }: UndoToastProps): JSX.Element {
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
