// Minimal in-panel toast system.
//
// One ToastProvider lives near the root of the side panel and exposes
// `useToast()` to every descendant. Consumers call `toast.success(...)`
// / `toast.error(...)` / `toast.info(...)`; the provider mounts the
// stack at the bottom of the viewport so it doesn't fight the chat
// input bar for the same row, auto-dismisses after a short window,
// and animates in/out.
//
// Why roll our own instead of pulling in a dep:
//   • The panel's first-paint bundle is tight and we already had to
//     code-split the heavy views to keep it small. A radix / sonner
//     install would undo that gain.
//   • The needs are narrow: 1–3 stacked toasts max, no actions, no
//     swipe-to-dismiss, no portal. ~120 lines covers the surface.
//   • Existing UI uses Tailwind + the same zinc palette — easier to
//     match the look in plain JSX than to override a vendor theme.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckIcon, XIcon } from "./icons";

type ToastKind = "success" | "error" | "info";

interface ToastRecord {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  /** Show a success toast. Returns the toast id so callers can dismiss
   *  it early if needed (e.g. swap a "Saving…" toast for "Saved"). */
  success: (message: string) => number;
  /** Show an error toast. Sticky-er than success — 5 s vs 2.4 s — so
   *  the user has time to read it. */
  error: (message: string) => number;
  /** Show a neutral info toast (used for transient state like
   *  "Recognising…"). */
  info: (message: string) => number;
  /** Remove a toast immediately. Safe to call on an id that has
   *  already been dismissed. */
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TTL_BY_KIND: Record<ToastKind, number> = {
  success: 2_400,
  info: 2_400,
  // Errors deserve a longer read window. Not sticky — the user can
  // always re-trigger by re-running the action.
  error: 5_000,
};

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextIdRef = useRef(1);
  // Timer handles per id so an early `dismiss()` cancels the pending
  // auto-removal — otherwise it'd fire later against a stale state.
  const timersRef = useRef<Map<number, number>>(new Map());

  const dismiss = useCallback((id: number): void => {
    const handle = timersRef.current.get(id);
    if (handle !== undefined) {
      window.clearTimeout(handle);
      timersRef.current.delete(id);
    }
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string): number => {
      const id = nextIdRef.current++;
      setToasts((cur) => {
        // Cap at 3 — older toasts roll off so a fast-clicking user
        // can't bury the panel under a stack of stale notices.
        const next = [...cur, { id, kind, message }];
        return next.length > 3 ? next.slice(next.length - 3) : next;
      });
      const handle = window.setTimeout(() => dismiss(id), TTL_BY_KIND[kind]);
      timersRef.current.set(id, handle);
      return id;
    },
    [dismiss],
  );

  // Clear every pending timer on unmount so we don't write into a
  // detached state and trigger a React warning.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const handle of timers.values()) window.clearTimeout(handle);
      timers.clear();
    };
  }, []);

  const api: ToastApi = useMemo(
    () => ({
      success: (m) => push("success", m),
      error: (m) => push("error", m),
      info: (m) => push("info", m),
      dismiss,
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/** Access the toast API. Throws if called outside a ToastProvider so
 *  the developer notices instead of silently swallowing a notice. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) {
    throw new Error("useToast() must be used inside a <ToastProvider>");
  }
  return api;
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastRecord[];
  onDismiss: (id: number) => void;
}): JSX.Element | null {
  if (toasts.length === 0) return null;
  return (
    <div
      // Bottom-center keeps the toast off the chat input bar's
      // primary action button (which lives bottom-right). `pointer-
      // events-none` on the wrapper means stray dead-zone clicks fall
      // through to underlying content; the toast cards themselves
      // re-enable pointer events.
      className="pointer-events-none absolute bottom-20 left-1/2 z-[60] flex w-full max-w-[360px] -translate-x-1/2 flex-col-reverse gap-2 px-3"
      // aria-live=polite so screen readers announce new toasts
      // without interrupting other speech; status implicitly
      // describes the region as live.
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} record={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

const KIND_STYLES: Record<ToastKind, string> = {
  success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100 [&_.dot]:bg-emerald-400",
  error: "border-red-500/40 bg-red-500/10 text-red-100 [&_.dot]:bg-red-400",
  info: "border-indigo-500/40 bg-indigo-500/10 text-indigo-100 [&_.dot]:bg-indigo-400",
};

function ToastCard({
  record,
  onDismiss,
}: {
  record: ToastRecord;
  onDismiss: () => void;
}): JSX.Element {
  return (
    <div
      className={`pointer-events-auto flex items-center gap-2 rounded-xl border px-3 py-2 shadow-lg shadow-black/40 backdrop-blur-md motion-safe:animate-[toast-in_140ms_ease-out] ${KIND_STYLES[record.kind]}`}
    >
      <style>{TOAST_KEYFRAMES}</style>
      <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center">
        {record.kind === "success" ? (
          <CheckIcon size={14} />
        ) : (
          <span className="dot h-2 w-2 rounded-full" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{record.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-current/70 transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current"
      >
        <XIcon size={12} />
      </button>
    </div>
  );
}

const TOAST_KEYFRAMES = `
@keyframes toast-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
`;
