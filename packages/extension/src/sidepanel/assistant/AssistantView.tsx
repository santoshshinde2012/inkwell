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
import {
  ExtensionContextInvalidatedError,
  sendToBackground,
} from "../../lib/messaging";
import type { NewHistoryEntry } from "../../lib/history";
import { OptionsSheet, useOptionsSummary } from "../OptionsSheet";
import { ACTION_THEMES } from "../actionTheme";
import { type BackendStatus } from "../../lib/backend";
import { consumeHandoff, HANDOFF_KEY } from "../../lib/ui-state";

import { ActionSegments } from "./ActionSegments";
import { ChatInputBar } from "./ChatInputBar";
import { HeroEmptyState } from "./HeroEmptyState";
import { OfflineBanner } from "./OfflineBanner";
import { ResultCard } from "./ResultCard";
import { AssistantTopBar } from "./TopBar";
import { SOURCE_PLACEHOLDERS } from "./constants";
import { useAssistantSettings } from "./useAssistantSettings";
import { useStreamingResult } from "./useStreamingResult";
import { buildTargetOptions, orderLanguages } from "./targetOptions";
import {
  captureActiveSelection,
  captureErrorMessage,
} from "./captureSelection";

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

  // Stay in sync if the parent's probe updates after we mount. Destructure
  // the setter so it can join the deps array honestly — useState setters
  // are reference-stable, so this won't cause extra re-runs.
  const { setBackend } = settings;
  useEffect(() => {
    setBackend({ status: parentBackendStatus, url: backendUrl });
  }, [parentBackendStatus, backendUrl, setBackend]);

  // -------------------------------------------------------------------------
  // Hand-off from the in-page popover.
  //
  // When the user clicks "Open in side panel" from the popover, the
  // background opens this panel and stashes their working text + action
  // under `ui.handoff`. We consume it on mount (covers the cold-open case)
  // AND react to storage changes (covers the warm case where the panel
  // was already open). `consumeHandoff` deletes the key in the same
  // round-trip, so each stash is delivered exactly once.
  // -------------------------------------------------------------------------
  const { setAction: applyAction } = settings;
  const applyHandoff = useCallback(async (): Promise<void> => {
    const h = await consumeHandoff();
    if (!h) return;
    if (h.text) setInputText(h.text);
    if (h.action) applyAction(h.action);
  }, [applyAction]);

  useEffect(() => {
    void applyHandoff();
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: chrome.storage.AreaName,
    ): void => {
      if (area !== "local") return;
      // Only react when a new value appeared (avoid the self-triggered
      // removal in consumeHandoff bouncing back through us).
      const change = changes[HANDOFF_KEY];
      if (!change || change.newValue == null) return;
      void applyHandoff();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [applyHandoff]);

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
        settings.setTargetChoice((cur) =>
          isLanguageId(cur) ? cur : settings.workingLanguage,
        );
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
    const { action, tone, model, sourceLang, targetChoice, workingLanguage } =
      settings;

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

  const hasResult = !!result.preview && !result.error && !result.streaming;
  const hasContent = result.streaming || hasResult || !!result.error;
  const offline = settings.backend.status === "down";
  const theme = ACTION_THEMES[settings.action];

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <AssistantTopBar
        backend={settings.backend}
        onOpenDrawer={onOpenDrawer}
        onOpenHistory={onOpenHistory}
      />

      <div className="border-b border-zinc-800/60 px-3 py-2">
        <ActionSegments current={settings.action} onChange={handleActionChange} />
      </div>

      {offline && <OfflineBanner onOpenSettings={onOpenSettings} />}

      <main className="flex flex-1 flex-col overflow-y-auto px-3 pb-2 pt-3">
        {hasContent ? (
          <ResultCard
            action={settings.action}
            theme={theme}
            preview={result.preview}
            streaming={result.streaming}
            error={result.error}
            errorAction={result.errorAction}
            canCopy={!!result.preview && !result.error}
            copied={result.copied}
            onCopy={() => void result.copy()}
            onRegenerate={() => void generate()}
          />
        ) : (
          <HeroEmptyState action={settings.action} theme={theme} />
        )}
      </main>

      <ChatInputBar
        action={settings.action}
        theme={theme}
        placeholder={SOURCE_PLACEHOLDERS[settings.action]}
        inputText={inputText}
        onInputChange={setInputText}
        onCapture={() => void captureSelection()}
        onOpenOptions={() => settings.setSheetOpen(true)}
        optsSummary={optsSummary}
        streaming={result.streaming}
        hasResult={hasResult}
        meta={result.usageMeta}
        onGenerate={() => void generate()}
        onCancel={cancel}
      />

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
