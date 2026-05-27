// Assistant view — the primary surface inside the Side Panel.
//
// Layout (mobile-app style, top → bottom):
//   1. Top bar with view title and a history shortcut
//   2. Compact segmented action picker (Reply / Translate / Grammar / Rewrite)
//   3. Result area — dominates the available vertical space, swapping
//      between a hero empty state and the live result card
//   4. Sticky chat-input bar with chip toolbar, textarea, and the
//      primary Send / Stop / Regenerate button
//
// Implementation notes:
//   - Per-request settings live in `useAssistantSettings` (single source
//     of truth for hydration + persistence).
//   - Streaming state and the chrome.runtime listener live in
//     `useStreamingResult` (one listener for the lifetime of the panel).
//   - Layout pieces (TopBar / ActionSegments / HeroEmptyState / ResultCard
//     / ChatInputBar) are presentational and unaware of streaming.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type Action,
  type CompleteCancelMessage,
  type CompleteStartMessage,
  isLanguageId,
  type LanguageId,
  MESSAGE_TYPES,
  type RequestContext,
} from "@inkwell/shared";
import { ExtensionContextInvalidatedError, sendToBackground } from "../../lib/messaging";
import type { NewHistoryEntry } from "../../lib/history";
import { OptionsSheet, useOptionsSummary } from "../OptionsSheet";
import { ACTION_THEMES } from "../actionTheme";
import { type BackendStatus } from "../../lib/backend";
import { consumeHandoff, HANDOFF_KEY } from "../../lib/ui-state";
import { useStorageChange } from "../../lib/useStorageChange";

import { ActionSegments } from "./ActionSegments";
import { ChatInputBar } from "./ChatInputBar";
import { ErrorBanner } from "./ErrorBanner";
import { HeroEmptyState } from "./HeroEmptyState";
import { OfflineBanner } from "./OfflineBanner";
import { ResultCard } from "./ResultCard";
import { AssistantTopBar } from "./TopBar";
import { SOURCE_PLACEHOLDERS } from "./constants";
import { useAssistantSettings } from "./useAssistantSettings";
import { useStreamingResult } from "./useStreamingResult";
import { buildTargetOptions, orderLanguages } from "./targetOptions";
import { captureActiveSelection, captureErrorMessage } from "./captureSelection";
import { extractTextFromImage, isImageBlob, OcrError, type OcrProgress } from "../../lib/ocr";

export interface AssistantViewProps {
  backendStatus: BackendStatus;
  backendUrl: string;
  onOpenDrawer: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
}

export function AssistantView({
  backendStatus: parentBackendStatus,
  backendUrl,
  onOpenDrawer,
  onOpenHistory,
  onOpenSettings,
}: AssistantViewProps): JSX.Element {
  const settings = useAssistantSettings({
    initialBackendStatus: parentBackendStatus,
    initialBackendUrl: backendUrl,
  });
  const result = useStreamingResult();

  // Per-input local state — small and view-specific, not worth hoisting.
  const [inputText, setInputText] = useState("");
  const [instruction, setInstruction] = useState("");

  // OCR state. `ocrStatus` is shown in the meta line while the image is
  // uploading / waiting on the backend's vision model. `dragOver` tracks
  // whether a file is being dragged over the panel so we can show a
  // visual hint without flickering on intra-element dragleave.
  const [ocrStatus, setOcrStatus] = useState<string | null>(null);
  const [dragDepth, setDragDepth] = useState(0);

  // Stay in sync if the parent's probe updates after we mount. Destructure
  // the setter so it can join the deps array honestly — useState setters
  // are reference-stable, so this won't cause extra re-runs.
  const { setBackend } = settings;
  useEffect(() => {
    setBackend({ status: parentBackendStatus, url: backendUrl });
  }, [parentBackendStatus, backendUrl, setBackend]);

  // -------------------------------------------------------------------------
  // OCR — runs against a Blob/File and pushes the recognised text into
  // the textarea. Used by the "+" image picker, paste, and drag-drop.
  // The right-click context menu has its own dedicated route through
  // the background service worker (src/background/index.ts).
  //
  // Backend-only: posts the image to /api/v1/ocr (gpt-4o-mini vision by
  // default). When the backend is unreachable, the error surfaces in
  // the result banner.
  // -------------------------------------------------------------------------
  const runOcr = useCallback(
    async (blob: Blob): Promise<void> => {
      if (ocrStatus !== null) return; // a recognition is already in flight
      setOcrStatus("Preparing OCR…");
      result.clearError();
      const onProgress = (p: OcrProgress): void => {
        const pct = typeof p.progress === "number" ? ` ${Math.round(p.progress * 100)}%` : "";
        setOcrStatus(`${p.status}${pct}`);
      };
      try {
        const text = await extractTextFromImage(blob, {
          backendUrl: settings.backend.url,
          onProgress,
        });
        // Append rather than replace so the user can OCR multiple images
        // and keep building up an input. Newline-separate to avoid joining
        // unrelated snippets into one line.
        setInputText((cur) => (cur ? `${cur.trimEnd()}\n\n${text}` : text));
      } catch (err) {
        const msg =
          err instanceof OcrError
            ? err.message
            : err instanceof Error
              ? err.message
              : "OCR failed.";
        result.surfaceError(msg);
      } finally {
        setOcrStatus(null);
      }
    },
    [ocrStatus, result, settings.backend.url],
  );

  // -------------------------------------------------------------------------
  // Hand-off from the in-page popover, or from the side-panel fallback
  // of the right-click context-menu OCR flow.
  //
  // Primary path: the in-page popover's "Open in side panel" button
  // stashes the working text + action so the user can keep editing in
  // the panel.
  //
  // Fallback path: when the right-click OCR can't deliver its result to
  // the page's content script (chrome:// / file:// without file-URL
  // access / sandboxed iframes), the background falls back to opening
  // the side panel and stashing the recognised text — or an error
  // message — through the same key.
  //
  // We consume the handoff on mount (covers the cold-open case) AND
  // react to storage changes (covers the warm case where the panel was
  // already open). `consumeHandoff` deletes the key in the same
  // round-trip, so each stash is delivered exactly once.
  // -------------------------------------------------------------------------
  const { setAction: applyAction } = settings;
  const applyHandoff = useCallback(async (): Promise<void> => {
    const h = await consumeHandoff();
    if (!h) return;
    if (h.text) setInputText(h.text);
    if (h.action) applyAction(h.action);
    if (h.errorMessage) {
      result.surfaceError(h.errorMessage);
    }
  }, [applyAction, result]);

  useEffect(() => {
    void applyHandoff();
  }, [applyHandoff]);

  // Only react when a new handoff value appears — `consumeHandoff`
  // removes the key after reading it, and that self-triggered removal
  // would otherwise bounce back through us. Filtering on `newValue`
  // keeps the loop one-shot.
  useStorageChange([HANDOFF_KEY], (changes) => {
    if (changes[HANDOFF_KEY]?.newValue == null) return;
    void applyHandoff();
  });

  // -------------------------------------------------------------------------
  // Derived: target picker options
  // -------------------------------------------------------------------------
  const targetOptions = useMemo(
    () =>
      buildTargetOptions(
        settings.action,
        orderLanguages(settings.frequentLanguages),
        settings.workingLanguage,
      ),
    [settings.action, settings.frequentLanguages, settings.workingLanguage],
  );

  // -------------------------------------------------------------------------
  // Action change — reconcile the target choice for the new mode, then
  // clear the previous result so the user sees a fresh empty state.
  // -------------------------------------------------------------------------
  const handleActionChange = useCallback(
    (next: Action) => {
      if (next === settings.action || result.streaming) return;
      settings.setAction(next);
      if (next === "translate") {
        settings.setTargetChoice((cur) => (isLanguageId(cur) ? cur : settings.workingLanguage));
      } else if (next === "rewrite") {
        settings.setTargetChoice((cur) => (cur === "bilingual" ? "match" : cur));
      }
      result.resetIdle();
    },
    [settings, result],
  );

  // -------------------------------------------------------------------------
  // Selection capture
  // -------------------------------------------------------------------------
  const captureSelection = useCallback(async () => {
    const r = await captureActiveSelection();
    if (r.kind === "ok") {
      setInputText(r.text);
      result.clearError();
      return;
    }
    // Selection failed (empty highlight or restricted page) — surface
    // the message without disturbing an existing preview or stream.
    result.surfaceError(captureErrorMessage(r.kind));
  }, [result]);

  // -------------------------------------------------------------------------
  // Generate / cancel
  // -------------------------------------------------------------------------
  const generate = useCallback(async (): Promise<void> => {
    if (result.streaming) return;
    const trimmed = inputText.trim();
    const trimmedInstruction = instruction.trim();
    const { action, tone, model, sourceLang, targetChoice, workingLanguage } = settings;

    const validation = validateInput(action, trimmed, trimmedInstruction);
    if (validation) {
      // Pre-flight failure — no stream has started, so leave any existing
      // preview alone and just surface the message inline.
      result.surfaceError(validation.message);
      if (validation.openSheet) settings.setSheetOpen(true);
      return;
    }

    const base = {
      site: "sidepanel",
      pageTitle: document.title.slice(0, 300),
      pageUrl: window.location.origin + window.location.pathname,
    };
    const context: RequestContext =
      action === "reply" || action === "translate"
        ? { ...base, post: { text: trimmed } }
        : { ...base, draft: trimmed };

    const { targetLanguage, bilingual } = resolveTargetLanguage(
      action,
      targetChoice,
      workingLanguage,
    );

    const streamId = crypto.randomUUID();
    const pendingHistory: NewHistoryEntry = {
      action,
      sourceLanguage: sourceLang,
      targetLanguage: targetLanguage ?? null,
      bilingual,
      inputText: trimmed || trimmedInstruction,
      outputText: "",
      site: base.site,
      conversationUrl: base.pageUrl,
      pageTitle: base.pageTitle,
    };

    result.beginStream(streamId, pendingHistory);

    const msg: CompleteStartMessage = {
      type: MESSAGE_TYPES.COMPLETE_START,
      streamId,
      payload: {
        action,
        context,
        tone,
        model,
        instruction: trimmedInstruction || undefined,
        sourceLanguage: sourceLang,
        ...(targetLanguage ? { targetLanguage } : {}),
        ...(bilingual ? { bilingual: true } : {}),
      },
    };
    try {
      const ack = await sendToBackground<{
        ok: boolean;
        error?: { message?: string };
      }>(msg);
      if (!ack?.ok) {
        result.failStream(ack?.error?.message ?? "Backend rejected the request.");
      }
    } catch (err) {
      if (err instanceof ExtensionContextInvalidatedError) {
        result.failStream(err.message, "refresh");
      } else {
        result.failStream(err instanceof Error ? err.message : "Failed to start.");
      }
    }
  }, [result, inputText, instruction, settings]);

  const cancel = useCallback(() => {
    const id = result.cancelStream();
    if (!id) return;
    void sendToBackground({
      type: MESSAGE_TYPES.COMPLETE_CANCEL,
      streamId: id,
    } satisfies CompleteCancelMessage);
  }, [result]);

  // Cmd/Ctrl+Enter generates from anywhere in the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void generate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [generate]);

  const optsSummary = useOptionsSummary({
    action: settings.action,
    sourceLang: settings.sourceLang,
    targetChoice: settings.targetChoice,
    tone: settings.tone,
    model: settings.model,
    instruction,
  });

  // `hasResult` no longer needs to gate on `!result.error` — errors
  // render as a banner above the main area now, not as a takeover.
  const hasResult = !!result.preview && !result.streaming;
  const hasContent = result.streaming || hasResult;
  const offline = settings.backend.status === "down";
  const theme = ACTION_THEMES[settings.action];

  // Drag-drop handlers. We use a depth counter rather than a boolean
  // because dragenter/dragleave fire on every child element as the
  // pointer moves over them — a boolean flickers.
  const onDragEnter = (e: React.DragEvent): void => {
    if (!hasImageInDrag(e.dataTransfer)) return;
    e.preventDefault();
    setDragDepth((d) => d + 1);
  };
  const onDragOver = (e: React.DragEvent): void => {
    if (!hasImageInDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (e: React.DragEvent): void => {
    if (!hasImageInDrag(e.dataTransfer)) return;
    setDragDepth((d) => Math.max(0, d - 1));
  };
  const onDrop = (e: React.DragEvent): void => {
    setDragDepth(0);
    const blob =
      (e.dataTransfer?.files && e.dataTransfer.files[0]) ||
      (e.dataTransfer?.items
        ? Array.from(e.dataTransfer.items)
            .find((i) => i.kind === "file" && i.type.startsWith("image/"))
            ?.getAsFile()
        : null);
    if (!blob || !isImageBlob(blob)) return;
    e.preventDefault();
    void runOcr(blob);
  };

  // The meta line under the textarea normally shows token usage. While
  // OCR is in flight we override it with the progress string so the
  // status surface stays in one place.
  const metaText = ocrStatus ?? result.usageMeta;

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <AssistantTopBar
        backend={settings.backend}
        onOpenDrawer={onOpenDrawer}
        onOpenHistory={onOpenHistory}
      />

      <div className="border-b border-zinc-800/60 px-3 py-2.5">
        <ActionSegments current={settings.action} onChange={handleActionChange} />
      </div>

      {offline && <OfflineBanner onOpenSettings={onOpenSettings} />}

      <main className="flex flex-1 flex-col overflow-y-auto px-3 pb-3 pt-4">
        {result.error && (
          <ErrorBanner
            message={result.error}
            action={result.errorAction}
            onDismiss={() => result.clearError()}
          />
        )}
        {hasContent ? (
          <ResultCard
            theme={theme}
            preview={result.preview}
            streaming={result.streaming}
            canCopy={!!result.preview}
            copied={result.copied}
            onCopy={() => void result.copy()}
            onRegenerate={() => void generate()}
          />
        ) : (
          <HeroEmptyState action={settings.action} theme={theme} />
        )}
      </main>

      <ChatInputBar
        theme={theme}
        placeholder={SOURCE_PLACEHOLDERS[settings.action]}
        inputText={inputText}
        onInputChange={setInputText}
        onCapture={() => void captureSelection()}
        onImage={(b) => void runOcr(b)}
        ocrBusy={ocrStatus !== null}
        onOpenOptions={() => settings.setSheetOpen(true)}
        optsSummary={optsSummary}
        streaming={result.streaming}
        hasResult={hasResult}
        meta={metaText}
        onGenerate={() => void generate()}
        onCancel={cancel}
      />

      {dragDepth > 0 && (
        <div
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-indigo-950/70 backdrop-blur-sm"
          aria-hidden="true"
        >
          <div className="rounded-2xl border-2 border-dashed border-indigo-400/70 bg-zinc-950/80 px-5 py-3 text-center text-sm font-medium text-indigo-200 shadow-lg">
            Drop image to extract text
          </div>
        </div>
      )}

      {settings.sheetOpen && (
        <OptionsSheet
          action={settings.action}
          sourceLang={settings.sourceLang}
          onSourceLang={settings.setSourceLang}
          targetChoice={settings.targetChoice}
          onTargetChoice={settings.setTargetChoice}
          targetOptions={targetOptions}
          tone={settings.tone}
          onTone={settings.setTone}
          model={settings.model}
          onModel={settings.setModel}
          instruction={instruction}
          onInstruction={setInstruction}
          disabled={result.streaming}
          onClose={() => settings.setSheetOpen(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

interface ValidationFailure {
  message: string;
  /** True when the failure also needs the user to open the Options sheet
   *  (rewrite can be satisfied from either the text input or the brief). */
  openSheet?: boolean;
}

function validateInput(
  action: Action,
  text: string,
  instruction: string,
): ValidationFailure | null {
  if (action === "reply" && !text) {
    return { message: "Add the text you want to reply to." };
  }
  if (action === "translate" && !text) {
    return { message: "Add the text you want to translate." };
  }
  if (action === "grammar" && !text) {
    return { message: "Add the text you want grammar-fixed." };
  }
  if (action === "rewrite" && !text && !instruction) {
    return {
      message: "Add text to rewrite, or open Options to describe what to write.",
      openSheet: true,
    };
  }
  return null;
}

function resolveTargetLanguage(
  action: Action,
  targetChoice: string,
  workingLanguage: LanguageId,
): { targetLanguage: LanguageId | undefined; bilingual: boolean } {
  if (action === "translate") {
    return {
      targetLanguage: isLanguageId(targetChoice) ? targetChoice : workingLanguage,
      bilingual: false,
    };
  }
  if (action === "reply" || action === "rewrite") {
    if (targetChoice === "bilingual") {
      return { targetLanguage: workingLanguage, bilingual: true };
    }
    if (isLanguageId(targetChoice)) {
      return { targetLanguage: targetChoice, bilingual: false };
    }
  }
  return { targetLanguage: undefined, bilingual: false };
}

// Drag events fire even when the user is dragging text/HTML around — we
// only care about image files. `types` includes "Files" when any file is
// being dragged; we further narrow by inspecting items if available.
function hasImageInDrag(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  if (!Array.from(dt.types).includes("Files")) return false;
  if (dt.items && dt.items.length > 0) {
    return Array.from(dt.items).some((i) => i.kind === "file" && i.type.startsWith("image/"));
  }
  // During dragenter on some browsers `items` is empty for security; fall
  // back to accepting any file-drag and validating on drop.
  return true;
}
