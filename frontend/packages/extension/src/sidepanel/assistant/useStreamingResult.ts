// Streaming output lifecycle for the Assistant view.
//
// Owns the preview text, streaming flag, usage meta, error, copy
// affordance and the chrome.runtime message wiring that bridges the
// background worker's COMPLETE_* events into React state. The component
// stays focused on layout and intent (generate / cancel / copy);
// everything below the abstraction line lives here.
//
// Notes:
//   - We mirror the streaming text into a ref so the COMPLETE_DONE
//     handler can read the final value deterministically (and skip the
//     double-fire that a setState updater would risk under StrictMode).
//   - The message listener is attached once on mount; the streamId ref
//     filters messages so we don't react to a previous (cancelled)
//     stream.

import { useCallback, useEffect, useRef, useState } from "react";
import { MESSAGE_TYPES } from "@inkwell/shared";
import { historyStore, type NewHistoryEntry } from "../../lib/history";
import { KBD } from "./constants";

export interface UseStreamingResult {
  preview: string;
  streaming: boolean;
  usageMeta: string;
  error: string | null;
  errorAction: "refresh" | null;
  copied: boolean;

  /**
   * Mark a new stream as in-flight. Resets preview/error and stores a
   * history record that will be saved with the accumulated text when
   * COMPLETE_DONE arrives. The returned cleanup primitives are used by
   * `cancel`, `setError`, and the COMPLETE_ERROR path.
   */
  beginStream: (streamId: string, pendingHistory: NewHistoryEntry) => void;

  /** Reset usage meta + abort any in-flight stream id tracking. */
  cancelStream: () => string | null;

  /** Surface a backend / client error and tear down any in-flight stream. */
  failStream: (msg: string, action?: "refresh" | null) => void;

  /** Surface an error inline without touching streaming state or the
   *  preview — used for non-stream failures like clipboard capture. */
  surfaceError: (msg: string, action?: "refresh" | null) => void;

  /** Clear any visible error without touching the preview. */
  clearError: () => void;

  /** Reset to an idle state with a fresh meta line (default: keyboard hint). */
  resetIdle: (meta?: string) => void;

  /** Copy current preview to the clipboard with a brief "Copied" toast. */
  copy: () => Promise<void>;
}

export function useStreamingResult(): UseStreamingResult {
  const [preview, setPreview] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [usageMeta, setUsageMeta] = useState<string>(`Press ${KBD} to generate`);
  const [error, setError] = useState<string | null>(null);
  const [errorAction, setErrorAction] = useState<"refresh" | null>(null);
  const [copied, setCopied] = useState(false);

  const streamIdRef = useRef<string | null>(null);
  const pendingHistoryRef = useRef<NewHistoryEntry | null>(null);
  const previewRef = useRef("");
  const copiedTimerRef = useRef<number | null>(null);

  // ---------------------------------------------------------------------------
  // Lifecycle: bind a single message listener for the lifetime of the panel.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const onMsg = (raw: unknown): boolean => {
      if (!raw || typeof raw !== "object" || !("type" in raw)) return false;
      const m = raw as {
        type: string;
        streamId?: string;
        delta?: unknown;
        usage?: { model?: string; totalTokens?: number } | null;
        error?: { message?: string } | null;
      };
      if ("streamId" in m && m.streamId !== streamIdRef.current) return false;
      switch (m.type) {
        case MESSAGE_TYPES.COMPLETE_TOKEN:
          if (typeof m.delta === "string") {
            const delta = m.delta;
            // Mirror into the ref synchronously. The COMPLETE_DONE
            // handler reads `previewRef.current` to commit the final
            // text to history, and we must not rely on React having
            // flushed the matching setState yet. Also: keeping the
            // append outside the state updater avoids the double-fire
            // that an updater function would trigger under StrictMode.
            previewRef.current += delta;
            setPreview((p) => p + delta);
          }
          return false;
        case MESSAGE_TYPES.COMPLETE_USAGE: {
          const u = m.usage;
          if (u) setUsageMeta(`${u.model ?? ""} · ${u.totalTokens ?? 0} tokens`);
          return false;
        }
        case MESSAGE_TYPES.COMPLETE_DONE: {
          setStreaming(false);
          streamIdRef.current = null;
          const pending = pendingHistoryRef.current;
          const finalText = previewRef.current;
          if (pending && finalText.trim()) {
            void historyStore.add({ ...pending, outputText: finalText });
          }
          pendingHistoryRef.current = null;
          return false;
        }
        case MESSAGE_TYPES.COMPLETE_ERROR:
          setStreaming(false);
          streamIdRef.current = null;
          pendingHistoryRef.current = null;
          setError(m.error?.message ?? "Something went wrong");
          return false;
        default:
          return false;
      }
    };
    chrome.runtime.onMessage.addListener(onMsg);
    return () => chrome.runtime.onMessage.removeListener(onMsg);
  }, []);

  // Cancel any pending copy timer on unmount.
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------
  const beginStream = useCallback((streamId: string, pendingHistory: NewHistoryEntry): void => {
    streamIdRef.current = streamId;
    pendingHistoryRef.current = pendingHistory;
    previewRef.current = "";
    setPreview("");
    setError(null);
    setErrorAction(null);
    setStreaming(true);
    setUsageMeta("Streaming…");
    setCopied(false);
  }, []);

  const cancelStream = useCallback((): string | null => {
    const id = streamIdRef.current;
    streamIdRef.current = null;
    pendingHistoryRef.current = null;
    setStreaming(false);
    setUsageMeta("Cancelled");
    return id;
  }, []);

  const failStream = useCallback((msg: string, action: "refresh" | null = null): void => {
    streamIdRef.current = null;
    pendingHistoryRef.current = null;
    setStreaming(false);
    setError(msg);
    setErrorAction(action);
  }, []);

  const surfaceError = useCallback((msg: string, action: "refresh" | null = null): void => {
    setError(msg);
    setErrorAction(action);
  }, []);

  const clearError = useCallback((): void => {
    setError(null);
    setErrorAction(null);
  }, []);

  const resetIdle = useCallback((meta?: string): void => {
    previewRef.current = "";
    setPreview("");
    setError(null);
    setErrorAction(null);
    setUsageMeta(meta ?? `Press ${KBD} to generate`);
  }, []);

  const copy = useCallback(async (): Promise<void> => {
    const text = previewRef.current;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        copiedTimerRef.current = null;
      }, 1600);
    } catch {
      setError("Couldn't copy. Select the text below and copy manually.");
    }
  }, []);

  return {
    preview,
    streaming,
    usageMeta,
    error,
    errorAction,
    copied,
    beginStream,
    cancelStream,
    failStream,
    surfaceError,
    clearError,
    resetIdle,
    copy,
  };
}
