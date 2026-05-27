// Hydrates and persists the Assistant view's per-request preferences plus
// the org-wide settings (working language, frequent languages, backend) it
// renders against.
//
// On mount the hook does a single batched read against chrome.storage.local
// and then keeps `last used` in sync as the user changes pickers. Saves are
// debounced implicitly by React batching — every change goes through one
// useEffect that calls `saveLastUsed`.

import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import {
  type Action,
  DEFAULT_MODEL_ID,
  DEFAULT_WORKING_LANGUAGE,
  type LanguageId,
  type ModelId,
  type SourceLanguage,
  TONE_PRESETS,
  type TonePreset,
} from "@inkwell/shared";
import { localStore } from "../../lib/storage";
import { probeBackend, type BackendStatus } from "../../lib/backend";
import {
  type TargetChoice,
  isValidAction,
  isValidModel,
  isValidSourceLang,
  isValidTargetChoice,
  isValidTone,
  loadLastUsed,
  loadOptsExpanded,
  saveLastUsed,
  saveOptsExpanded,
} from "../../lib/ui-state";

// Setters are exposed as the raw `Dispatch<SetStateAction<T>>` so callers
// may pass either a value or an updater function (e.g. `setTargetChoice
// (cur => isLanguageId(cur) ? cur : workingLanguage)` in handleActionChange).
// Keeping every setter on the same shape removes a hidden API split.
export interface UseAssistantSettings {
  loaded: boolean;
  action: Action;
  setAction: Dispatch<SetStateAction<Action>>;
  tone: TonePreset;
  setTone: Dispatch<SetStateAction<TonePreset>>;
  model: ModelId;
  setModel: Dispatch<SetStateAction<ModelId>>;
  sourceLang: SourceLanguage;
  setSourceLang: Dispatch<SetStateAction<SourceLanguage>>;
  targetChoice: TargetChoice;
  setTargetChoice: Dispatch<SetStateAction<TargetChoice>>;
  sheetOpen: boolean;
  setSheetOpen: Dispatch<SetStateAction<boolean>>;
  workingLanguage: LanguageId;
  frequentLanguages: LanguageId[];
  backend: { status: BackendStatus; url: string };
  setBackend: Dispatch<SetStateAction<{ status: BackendStatus; url: string }>>;
}

export interface AssistantSettingsInput {
  initialBackendStatus: BackendStatus;
  initialBackendUrl: string;
}

export function useAssistantSettings({
  initialBackendStatus,
  initialBackendUrl,
}: AssistantSettingsInput): UseAssistantSettings {
  const [loaded, setLoaded] = useState(false);

  const [action, setAction] = useState<Action>("reply");
  const [tone, setTone] = useState<TonePreset>(TONE_PRESETS[0]!);
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL_ID);
  const [sourceLang, setSourceLang] = useState<SourceLanguage>("auto");
  const [targetChoice, setTargetChoice] = useState<TargetChoice>("match");
  const [sheetOpen, setSheetOpen] = useState(false);

  const [workingLanguage, setWorkingLanguage] = useState<LanguageId>(DEFAULT_WORKING_LANGUAGE);
  const [frequentLanguages, setFrequentLanguages] = useState<LanguageId[]>([]);
  const [backend, setBackend] = useState<{ status: BackendStatus; url: string }>({
    status: initialBackendStatus,
    url: initialBackendUrl,
  });

  // -------------------------------------------------------------------------
  // Hydrate from storage on mount
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [opts, lastUsed, settings] = await Promise.all([
        loadOptsExpanded(),
        loadLastUsed(),
        localStore.getAll().catch(() => null),
      ]);
      if (cancelled) return;
      // `opts` is the legacy "options disclosure expanded" flag; reused
      // to decide whether to open the sheet automatically on first
      // mount — usually `false`, so this is a no-op for most users.
      if (opts) setSheetOpen(true);
      if (isValidAction(lastUsed.action)) setAction(lastUsed.action);
      setTone(
        isValidTone(lastUsed.tone) ? lastUsed.tone : (settings?.defaultTone ?? TONE_PRESETS[0]!),
      );
      setModel(
        isValidModel(lastUsed.model)
          ? lastUsed.model
          : (settings?.defaultModel ?? DEFAULT_MODEL_ID),
      );
      if (isValidSourceLang(lastUsed.sourceLang)) setSourceLang(lastUsed.sourceLang);
      if (isValidTargetChoice(lastUsed.targetChoice)) setTargetChoice(lastUsed.targetChoice);
      setWorkingLanguage(settings?.workingLanguage ?? DEFAULT_WORKING_LANGUAGE);
      setFrequentLanguages(settings?.frequentLanguages ?? []);
      setLoaded(true);
      void probeBackend(settings?.backendUrl, settings?.apiKey).then((s) => {
        if (!cancelled) setBackend(s);
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // -------------------------------------------------------------------------
  // Keep "last used" in sync once hydrated
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!loaded) return;
    saveLastUsed({ action, tone, model, sourceLang, targetChoice });
  }, [loaded, action, tone, model, sourceLang, targetChoice]);

  useEffect(() => {
    if (!loaded) return;
    saveOptsExpanded(sheetOpen);
  }, [loaded, sheetOpen]);

  return {
    loaded,
    action,
    setAction,
    tone,
    setTone,
    model,
    setModel,
    sourceLang,
    setSourceLang,
    targetChoice,
    setTargetChoice,
    sheetOpen,
    setSheetOpen,
    workingLanguage,
    frequentLanguages,
    backend,
    setBackend,
  };
}
