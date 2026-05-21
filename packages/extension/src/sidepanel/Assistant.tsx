// Assistant view — the primary surface inside the Side Panel.
//
// Layout (mobile-app style, top → bottom):
//   1. Top bar with view title and a history shortcut
//   2. Compact segmented action picker (Reply / Translate / Grammar / Rewrite)
//   3. Input card (label + textarea + "Use selection")
//   4. Result card — dominates the available vertical space
//   5. Action bar (sticky): Options chip + Generate (and Regenerate /
//      Cancel when a result exists or a stream is in flight)
//
// Options have moved out of an inline disclosure and into a bottom-sheet
// modal that slides up from the action bar — much cleaner at narrow
// widths and a familiar mobile pattern.
//
// Every successful generation is recorded in `historyStore`, so the
// History tab is populated regardless of where the user triggered Inkwell
// from.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Action,
  CompleteCancelMessage,
  CompleteStartMessage,
  DEFAULT_MODEL_ID,
  DEFAULT_WORKING_LANGUAGE,
  LANGUAGE_CATALOG,
  LanguageId,
  MESSAGE_TYPES,
  ModelId,
  RequestContext,
  SourceLanguage,
  TONE_PRESETS,
  TonePreset,
  getLanguageInfo,
  isLanguageId,
  languageDisplayName,
  languageLabel,
} from "@inkwell/shared";
import { sendToBackground } from "../lib/messaging";
import { localStore } from "../lib/storage";
import { historyStore, type NewHistoryEntry } from "../lib/history";
import {
  TargetChoice,
  loadOptsExpanded,
  saveOptsExpanded,
  loadLastUsed,
  saveLastUsed,
  isValidAction,
  isValidTone,
  isValidModel,
  isValidSourceLang,
  isValidTargetChoice,
} from "../lib/ui-state";
import { OptionsSheet, useOptionsSummary } from "./OptionsSheet";
import { ACTION_THEMES, type ActionTheme } from "./actionTheme";
import {
  ArrowRightIcon,
  CheckIcon,
  CopyIcon,
  GrammarIcon,
  HistoryIcon,
  MenuIcon,
  PlusIcon,
  RewriteIcon,
  ReplyIcon,
  SendIcon,
  SlidersIcon,
  SparkleIcon,
  SquareIcon,
  TranslateIcon,
  XIcon,
} from "./icons";
import { probeBackend, type BackendStatus } from "../lib/backend";

const ACTION_LABELS: Record<Action, string> = {
  reply: "Reply",
  translate: "Translate",
  grammar: "Grammar",
  rewrite: "Rewrite",
};
const ACTION_HINTS: Record<Action, string> = {
  reply: "Drafts a contextual reply — in the customer's language, yours, or both.",
  translate: "Translates the text into the language you choose.",
  grammar: "Fixes grammar and spelling in the text's own language — no translation.",
  rewrite: "Rewrites for tone, length, or clarity — optionally into another language.",
};
const SOURCE_PLACEHOLDERS: Record<Action, string> = {
  reply: "Paste or type the message you're replying to…",
  translate: "Paste or type the customer's message to translate…",
  grammar: "Paste or type the text whose grammar you want fixed…",
  rewrite:
    "Paste or type the text to rewrite (or leave blank and add a brief in Options)…",
};

const KBD = navigator.platform.includes("Mac") ? "⌘↵" : "Ctrl+↵";

// ---------------------------------------------------------------------------
// Assistant view
// ---------------------------------------------------------------------------

export function AssistantView({
  backendStatus: parentBackendStatus,
  backendUrl,
  onOpenDrawer,
  onOpenHistory,
  onOpenSettings,
}: {
  backendStatus: BackendStatus;
  backendUrl: string;
  onOpenDrawer: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
}): JSX.Element {
  const [loaded, setLoaded] = useState(false);

  // Per-request settings
  const [action, setAction] = useState<Action>("reply");
  const [tone, setTone] = useState<TonePreset>(TONE_PRESETS[0]!);
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL_ID);
  const [sourceLang, setSourceLang] = useState<SourceLanguage>("auto");
  const [targetChoice, setTargetChoice] = useState<TargetChoice>("match");
  const [instruction, setInstruction] = useState("");
  const [inputText, setInputText] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);

  // Streaming + output
  const [preview, setPreview] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [usageMeta, setUsageMeta] = useState<string>(`Press ${KBD} to generate`);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const streamIdRef = useRef<string | null>(null);
  const pendingHistoryRef = useRef<NewHistoryEntry | null>(null);
  const copiedTimerRef = useRef<number | null>(null);
  // Tracks the accumulated stream text without going through React state
  // so the COMPLETE_DONE handler can read the final text deterministically
  // (and avoid side effects inside a setState updater, which can fire
  // twice under StrictMode).
  const previewRef = useRef("");

  // Org-wide settings (read once at mount)
  const [workingLanguage, setWorkingLanguage] = useState<LanguageId>(
    DEFAULT_WORKING_LANGUAGE,
  );
  const [frequentLanguages, setFrequentLanguages] = useState<LanguageId[]>([]);
  const [backend, setBackend] = useState<{ status: BackendStatus; url: string }>(
    { status: parentBackendStatus, url: backendUrl },
  );

  useEffect(() => {
    setBackend({ status: parentBackendStatus, url: backendUrl });
  }, [parentBackendStatus, backendUrl]);

  // -------------------------------------------------------------------------
  // Hydrate persisted UI state on mount
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
      // `opts` is the legacy "options disclosure expanded" flag; we reuse
      // it to decide whether to open the sheet automatically on first
      // mount — usually `false`, so this is a no-op for most users.
      if (opts) setSheetOpen(true);
      if (isValidAction(lastUsed.action)) setAction(lastUsed.action);
      setTone(
        isValidTone(lastUsed.tone)
          ? lastUsed.tone
          : (settings?.defaultTone ?? TONE_PRESETS[0]!),
      );
      setModel(
        isValidModel(lastUsed.model)
          ? lastUsed.model
          : (settings?.defaultModel ?? DEFAULT_MODEL_ID),
      );
      if (isValidSourceLang(lastUsed.sourceLang))
        setSourceLang(lastUsed.sourceLang);
      if (isValidTargetChoice(lastUsed.targetChoice))
        setTargetChoice(lastUsed.targetChoice);
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

  useEffect(() => {
    if (!loaded) return;
    saveLastUsed({ action, tone, model, sourceLang, targetChoice });
  }, [loaded, action, tone, model, sourceLang, targetChoice]);

  useEffect(() => {
    if (!loaded) return;
    saveOptsExpanded(sheetOpen);
  }, [loaded, sheetOpen]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  // -------------------------------------------------------------------------
  // Streaming wiring
  // -------------------------------------------------------------------------
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
            previewRef.current += delta;
            setPreview((p) => p + delta);
          }
          return false;
        case MESSAGE_TYPES.COMPLETE_USAGE: {
          const u = m.usage;
          if (u)
            setUsageMeta(`${u.model ?? ""} · ${u.totalTokens ?? 0} tokens`);
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

  // -------------------------------------------------------------------------
  // Derived: language picker options
  // -------------------------------------------------------------------------
  const orderedLanguages = useMemo<LanguageId[]>(() => {
    const freq = frequentLanguages.filter((id) => getLanguageInfo(id));
    const rest = LANGUAGE_CATALOG.map((l) => l.id).filter(
      (id) => !freq.includes(id),
    );
    return [...freq, ...rest];
  }, [frequentLanguages]);

  const targetOptions = useMemo<{ value: string; label: string }[]>(() => {
    const langs = orderedLanguages.map((id) => ({
      value: id,
      label: languageDisplayName(id),
    }));
    if (action === "translate") return langs;
    if (action === "reply")
      return [
        { value: "match", label: "Customer's language" },
        {
          value: "bilingual",
          label: `Bilingual (+ ${languageLabel(workingLanguage)})`,
        },
        ...langs,
      ];
    if (action === "rewrite")
      return [{ value: "match", label: "Keep source language" }, ...langs];
    return [];
  }, [action, orderedLanguages, workingLanguage]);

  // -------------------------------------------------------------------------
  // Action change
  // -------------------------------------------------------------------------
  const handleActionChange = useCallback(
    (next: Action) => {
      if (next === action || streaming) return;
      setAction(next);
      if (next === "translate") {
        setTargetChoice((cur) => (isLanguageId(cur) ? cur : workingLanguage));
      } else if (next === "rewrite") {
        setTargetChoice((cur) => (cur === "bilingual" ? "match" : cur));
      }
      setPreview("");
      previewRef.current = "";
      setError(null);
      setUsageMeta(`Press ${KBD} to generate`);
    },
    [action, streaming, workingLanguage],
  );

  // -------------------------------------------------------------------------
  // Capture selection from the active tab
  // -------------------------------------------------------------------------
  const captureSelection = useCallback(async () => {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) return;
      const res = (await chrome.tabs.sendMessage(tab.id, {
        type: "GET_SELECTION",
      })) as { text?: string } | undefined;
      const text = (res?.text ?? "").trim();
      if (text) {
        setInputText(text);
        setError(null);
      } else {
        setError(
          "No text is selected on the active tab. Highlight some text first, then try again.",
        );
      }
    } catch {
      setError(
        "Can't read from the active tab — Inkwell's content script doesn't run on internal browser pages.",
      );
    }
  }, []);

  // -------------------------------------------------------------------------
  // Generate / cancel / copy
  // -------------------------------------------------------------------------
  const generate = useCallback(async (): Promise<void> => {
    if (streaming) return;
    const trimmed = inputText.trim();
    const trimmedInstruction = instruction.trim();

    if (action === "reply" && !trimmed) {
      setError("Add the text you want to reply to.");
      return;
    }
    if (action === "translate" && !trimmed) {
      setError("Add the text you want to translate.");
      return;
    }
    if (action === "grammar" && !trimmed) {
      setError("Add the text you want grammar-fixed.");
      return;
    }
    if (action === "rewrite" && !trimmed && !trimmedInstruction) {
      setError("Add text to rewrite, or open Options to describe what to write.");
      setSheetOpen(true);
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

    let targetLanguage: LanguageId | undefined;
    let bilingual = false;
    if (action === "translate") {
      targetLanguage = isLanguageId(targetChoice)
        ? targetChoice
        : workingLanguage;
    } else if (action === "reply" || action === "rewrite") {
      if (targetChoice === "bilingual") {
        bilingual = true;
        targetLanguage = workingLanguage;
      } else if (isLanguageId(targetChoice)) {
        targetLanguage = targetChoice;
      }
    }

    const streamId = crypto.randomUUID();
    streamIdRef.current = streamId;

    pendingHistoryRef.current = {
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

    previewRef.current = "";
    setPreview("");
    setError(null);
    setStreaming(true);
    setUsageMeta("Streaming…");
    setCopied(false);

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
        setStreaming(false);
        streamIdRef.current = null;
        pendingHistoryRef.current = null;
        setError(ack?.error?.message ?? "Backend rejected the request.");
      }
    } catch (err) {
      setStreaming(false);
      streamIdRef.current = null;
      pendingHistoryRef.current = null;
      setError(err instanceof Error ? err.message : "Failed to start.");
    }
  }, [
    streaming,
    inputText,
    instruction,
    action,
    tone,
    model,
    sourceLang,
    targetChoice,
    workingLanguage,
  ]);

  const cancel = useCallback(() => {
    const id = streamIdRef.current;
    if (!id) return;
    void sendToBackground({
      type: MESSAGE_TYPES.COMPLETE_CANCEL,
      streamId: id,
    } satisfies CompleteCancelMessage);
    setStreaming(false);
    streamIdRef.current = null;
    pendingHistoryRef.current = null;
    setUsageMeta("Cancelled");
  }, []);

  const copy = useCallback(async () => {
    if (!preview) return;
    try {
      await navigator.clipboard.writeText(preview);
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
  }, [preview]);

  // Cmd/Ctrl+Enter generates from anywhere in the panel
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
    action,
    sourceLang,
    targetChoice,
    tone,
    model,
    instruction,
  });

  const hasResult = !!preview && !error && !streaming;
  const offline = backend.status === "down";

  const hasContent = streaming || hasResult || !!error;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <TopBar
        backend={backend}
        onOpenDrawer={onOpenDrawer}
        onOpenHistory={onOpenHistory}
      />

      <div className="border-b border-zinc-800/60 px-3 py-2">
        <ActionSegments current={action} onChange={handleActionChange} />
      </div>

      {offline && <OfflineBanner onOpenSettings={onOpenSettings} />}

      <main className="flex flex-1 flex-col overflow-y-auto px-3 pb-2 pt-3">
        {hasContent ? (
          <ResultCard
            action={action}
            theme={ACTION_THEMES[action]}
            preview={preview}
            streaming={streaming}
            error={error}
            canCopy={!!preview && !error}
            copied={copied}
            onCopy={() => void copy()}
            onRegenerate={() => void generate()}
          />
        ) : (
          <HeroEmptyState action={action} theme={ACTION_THEMES[action]} />
        )}
      </main>

      <ChatInputBar
        action={action}
        theme={ACTION_THEMES[action]}
        placeholder={SOURCE_PLACEHOLDERS[action]}
        inputText={inputText}
        onInputChange={setInputText}
        onCapture={captureSelection}
        onOpenOptions={() => setSheetOpen(true)}
        optsSummary={optsSummary}
        streaming={streaming}
        hasResult={hasResult}
        meta={usageMeta}
        onGenerate={() => void generate()}
        onCancel={cancel}
      />

      {sheetOpen && (
        <OptionsSheet
          action={action}
          sourceLang={sourceLang}
          onSourceLang={setSourceLang}
          targetChoice={targetChoice}
          onTargetChoice={setTargetChoice}
          targetOptions={targetOptions}
          tone={tone}
          onTone={setTone}
          model={model}
          onModel={setModel}
          instruction={instruction}
          onInstruction={setInstruction}
          disabled={streaming}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

function TopBar({
  backend,
  onOpenDrawer,
  onOpenHistory,
}: {
  backend: { status: BackendStatus; url: string };
  onOpenDrawer: () => void;
  onOpenHistory: () => void;
}): JSX.Element {
  return (
    <header className="flex items-center gap-2 border-b border-zinc-800 px-2 py-2.5">
      <button
        type="button"
        onClick={onOpenDrawer}
        title="Menu (⌘B)"
        aria-label="Open menu"
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500"
      >
        <MenuIcon size={17} />
      </button>
      <div className="min-w-0 flex-1 text-center">
        <div className="truncate text-[14px] font-semibold tracking-tight text-zinc-50">
          Assistant
        </div>
        <div
          className="truncate text-[10.5px] text-zinc-500"
          title={backend.url || undefined}
        >
          {backend.status === "ok" && "Connected to backend"}
          {backend.status === "down" && "Backend offline"}
          {backend.status === "checking" && "Connecting…"}
        </div>
      </div>
      <button
        type="button"
        onClick={onOpenHistory}
        title="Open history"
        aria-label="Open history"
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500"
      >
        <HistoryIcon size={16} />
      </button>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Offline banner — surfaces when the backend probe fails, with a direct
// link to Settings → Backend so the user can configure URL + key without
// having to leave the side panel.
// ---------------------------------------------------------------------------

function OfflineBanner({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}): JSX.Element {
  return (
    <div
      role="alert"
      className="mx-3 mt-3 flex items-start gap-2.5 rounded-2xl border border-red-900/60 bg-red-950/30 px-3 py-2.5 text-red-100 shadow-sm shadow-red-950/40"
    >
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-red-500/15 text-red-300"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
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

// ---------------------------------------------------------------------------
// Action segments
// ---------------------------------------------------------------------------

function ActionSegments({
  current,
  onChange,
}: {
  current: Action;
  onChange: (a: Action) => void;
}): JSX.Element {
  const items: { id: Action; icon: JSX.Element; label: string }[] = [
    { id: "reply", icon: <ReplyIcon size={13} />, label: "Reply" },
    { id: "translate", icon: <TranslateIcon size={13} />, label: "Translate" },
    { id: "grammar", icon: <GrammarIcon size={13} />, label: "Grammar" },
    { id: "rewrite", icon: <RewriteIcon size={13} />, label: "Rewrite" },
  ];
  return (
    <div
      role="tablist"
      aria-label="Action"
      className="grid grid-cols-4 gap-0.5 rounded-2xl border border-zinc-800 bg-zinc-900/80 p-1 shadow-inner shadow-black/20"
    >
      {items.map((it) => {
        const active = it.id === current;
        const theme = ACTION_THEMES[it.id];
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={it.label}
            title={it.label}
            onClick={() => onChange(it.id)}
            className={`inline-flex h-10 flex-col items-center justify-center gap-0.5 rounded-xl transition-all duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 ${
              active
                ? `${theme.tabActive} ${theme.tabRing}`
                : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100"
            }`}
          >
            {it.icon}
            <span className="text-[9.5px] font-medium tracking-tight">
              {it.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero empty state — the welcoming screen shown until the user generates
// something. Mirrors the reference's "Start the conversation" empty state
// with a hero icon, heading, description and status pills underneath.
// ---------------------------------------------------------------------------

function HeroEmptyState({
  action,
  theme,
}: {
  action: Action;
  theme: ActionTheme;
}): JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-6 text-center">
      <span
        className={`flex h-16 w-16 items-center justify-center rounded-3xl bg-zinc-900/80 ring-1 ring-zinc-800 ${theme.accentIcon}`}
      >
        <SparkleIcon size={24} />
      </span>
      <div>
        <div className="text-[15px] font-semibold tracking-tight text-zinc-50">
          {EMPTY_TITLES[action]}
        </div>
        <p className="mx-auto mt-1 max-w-[34ch] text-[12px] leading-relaxed text-zinc-400">
          {ACTION_HINTS[action]}
        </p>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
        <StatusPill tone="emerald" label="AI Ready" />
        <StatusPill tone="indigo" label="Local-only" />
      </div>

      <p className="mt-2 text-[10.5px] text-zinc-500">
        Type below or paste a selection to begin.
      </p>
    </div>
  );
}

const EMPTY_TITLES: Record<Action, string> = {
  reply: "Draft your reply",
  translate: "Translate something",
  grammar: "Fix grammar & spelling",
  rewrite: "Rewrite or compose",
};

function StatusPill({
  tone,
  label,
}: {
  tone: "emerald" | "indigo";
  label: string;
}): JSX.Element {
  const dot =
    tone === "emerald"
      ? "bg-emerald-400"
      : "bg-indigo-400";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900/80 px-2 py-1 text-[10.5px] font-medium text-zinc-300 ring-1 ring-inset ring-zinc-800">
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function ResultCard({
  action,
  theme,
  preview,
  streaming,
  error,
  canCopy,
  copied,
  onCopy,
  onRegenerate,
}: {
  action: Action;
  theme: ActionTheme;
  preview: string;
  streaming: boolean;
  error: string | null;
  canCopy: boolean;
  copied: boolean;
  onCopy: () => void;
  onRegenerate: () => void;
}): JSX.Element {
  let state: "empty" | "streaming" | "ready" | "error" = "empty";
  if (error) state = "error";
  else if (streaming) state = "streaming";
  else if (preview) state = "ready";

  return (
    <section className="flex min-h-[160px] flex-1 flex-col">
      <div className="mb-1.5 flex items-center justify-between px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Result
        </span>
        <div className="flex items-center gap-1">
          {state === "ready" && (
            <button
              type="button"
              onClick={onRegenerate}
              title="Regenerate with the same options"
              aria-label="Regenerate"
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10.5px] font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
            >
              <RegenerateIcon />
              Regenerate
            </button>
          )}
          {canCopy && (
            <button
              type="button"
              onClick={onCopy}
              title="Copy the result to the clipboard"
              aria-label={copied ? "Copied" : "Copy result"}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10.5px] font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
            >
              {copied ? <CheckIcon size={11} /> : <CopyIcon size={11} />}
              {copied ? "Copied" : "Copy"}
            </button>
          )}
        </div>
      </div>
      <div
        aria-live="polite"
        className={`flex-1 overflow-y-auto rounded-2xl border p-3 text-[13px] leading-relaxed transition-colors ${
          state === "empty"
            ? "border-dashed border-zinc-800 bg-zinc-950/40 text-zinc-500"
            : state === "streaming"
              ? `${theme.resultBorder} ${theme.resultGlow} text-zinc-100`
              : state === "error"
                ? "border-red-900/60 bg-red-950/20 text-red-200"
                : `${theme.resultBorder} bg-zinc-900 text-zinc-100 shadow-sm shadow-black/20`
        }`}
      >
        {state === "error" ? (
          <div className="flex items-start gap-2">
            <XIcon size={14} />
            <span>{error}</span>
          </div>
        ) : preview ? (
          <div
            dir="auto"
            className={`whitespace-pre-wrap break-words ${
              streaming
                ? `after:ml-0.5 after:inline-block after:h-[1em] after:w-px after:animate-pulse after:align-[-2px] ${theme.caret}`
                : ""
            }`}
          >
            {preview}
          </div>
        ) : streaming ? (
          <ThinkingDots theme={theme} />
        ) : (
          <EmptyResult action={action} theme={theme} />
        )}
      </div>
    </section>
  );
}

function EmptyResult({
  action,
  theme,
}: {
  action: Action;
  theme: ActionTheme;
}): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-4 text-center">
      <span
        className={`flex h-10 w-10 items-center justify-center rounded-2xl bg-zinc-900/80 ring-1 ring-zinc-800 ${theme.accentIcon}`}
      >
        <SparkleIcon size={16} />
      </span>
      <div>
        <div className="text-[13px] font-semibold text-zinc-100">
          {ACTION_LABELS[action]}
        </div>
        <p className="mx-auto mt-1 max-w-[28ch] text-[11.5px] leading-relaxed text-zinc-500">
          {ACTION_HINTS[action]}
        </p>
      </div>
    </div>
  );
}

function ThinkingDots({ theme }: { theme: ActionTheme }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 text-zinc-400">
      Thinking
      <span className="inline-flex gap-0.5">
        <Dot delay={0} theme={theme} />
        <Dot delay={150} theme={theme} />
        <Dot delay={300} theme={theme} />
      </span>
    </span>
  );
}

function Dot({
  delay,
  theme,
}: {
  delay: number;
  theme: ActionTheme;
}): JSX.Element {
  return (
    <span
      className={`inline-block h-1 w-1 animate-bounce rounded-full ${theme.dotBg}`}
      style={{ animationDelay: `${delay}ms`, animationDuration: "1.1s" }}
    />
  );
}

// ---------------------------------------------------------------------------
// Chat-input bar — chip toolbar above a chat-style textarea with a + button
// to capture the active tab's selection and a circular send button on the
// right. Switches behaviour when a stream is in flight (becomes Stop) or
// when a result is on screen (becomes Regenerate).
// ---------------------------------------------------------------------------

function ChatInputBar({
  action,
  theme,
  placeholder,
  inputText,
  onInputChange,
  onCapture,
  onOpenOptions,
  optsSummary,
  streaming,
  hasResult,
  meta,
  onGenerate,
  onCancel,
}: {
  action: Action;
  theme: ActionTheme;
  placeholder: string;
  inputText: string;
  onInputChange: (v: string) => void;
  onCapture: () => void;
  onOpenOptions: () => void;
  optsSummary: string;
  streaming: boolean;
  hasResult: boolean;
  meta: string;
  onGenerate: () => void;
  onCancel: () => void;
}): JSX.Element {
  const mode: "stop" | "regenerate" | "generate" = streaming
    ? "stop"
    : hasResult
      ? "regenerate"
      : "generate";

  return (
    <footer className="border-t border-zinc-800 bg-zinc-900/60 px-2.5 py-2 backdrop-blur">
      <ChipToolbar
        action={action}
        theme={theme}
        optsSummary={optsSummary}
        onOpenOptions={onOpenOptions}
        onCapture={onCapture}
      />

      <div className="relative mt-1.5 flex items-end gap-1.5 rounded-2xl border border-zinc-800 bg-zinc-950 px-1.5 py-1.5 transition-colors focus-within:border-zinc-700 focus-within:bg-zinc-900">
        <button
          type="button"
          onClick={onCapture}
          title="Use the active tab's current selection"
          aria-label="Use page selection"
          className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-zinc-300 ring-1 ring-inset ring-zinc-800 transition-colors hover:bg-zinc-800 hover:text-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500"
        >
          <PlusIcon size={14} />
        </button>
        <textarea
          dir="auto"
          rows={1}
          placeholder={placeholder}
          value={inputText}
          onChange={(e) => onInputChange(e.target.value)}
          onInput={(e) => {
            // Auto-grow up to ~6 rows.
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = Math.min(el.scrollHeight, 144) + "px";
          }}
          className="block min-h-[36px] max-h-36 flex-1 resize-none bg-transparent px-1 py-2 text-[13px] leading-relaxed text-zinc-100 placeholder-zinc-500 caret-indigo-400 focus:outline-none"
        />
        <PrimaryButton
          mode={mode}
          theme={theme}
          onGenerate={onGenerate}
          onCancel={onCancel}
        />
      </div>

      <div className="mt-1 truncate text-center text-[10px] text-zinc-500" title={meta}>
        {meta}
      </div>
    </footer>
  );
}

function ChipToolbar({
  action,
  theme,
  optsSummary,
  onOpenOptions,
  onCapture,
}: {
  action: Action;
  theme: ActionTheme;
  optsSummary: string;
  onOpenOptions: () => void;
  onCapture: () => void;
}): JSX.Element {
  const ActionIcon = ACTION_ICON[action];
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <span
        title={`Mode: ${ACTION_LABELS[action]}`}
        className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium ring-1 ring-inset ${theme.tabActive} ${theme.tabRing}`}
      >
        <ActionIcon size={11} />
        {ACTION_LABELS[action]}
      </span>
      <button
        type="button"
        onClick={onOpenOptions}
        aria-haspopup="dialog"
        title="Open options"
        className="inline-flex max-w-[200px] flex-shrink-0 items-center gap-1.5 rounded-full bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 ring-1 ring-inset ring-zinc-800 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500"
      >
        <SlidersIcon size={11} />
        <span className="truncate font-medium">{optsSummary}</span>
      </button>
      <button
        type="button"
        onClick={onCapture}
        title="Use the active tab's current selection"
        className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full bg-zinc-900 px-2 py-1 text-[11px] font-medium text-zinc-300 ring-1 ring-inset ring-zinc-800 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500"
      >
        <SparkleIcon size={10} />
        Selection
      </button>
    </div>
  );
}

function PrimaryButton({
  mode,
  theme,
  onGenerate,
  onCancel,
}: {
  mode: "stop" | "regenerate" | "generate";
  theme: ActionTheme;
  onGenerate: () => void;
  onCancel: () => void;
}): JSX.Element {
  if (mode === "stop") {
    return (
      <button
        type="button"
        onClick={onCancel}
        title="Stop generation"
        aria-label="Stop generation"
        className="relative inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-red-900/60 bg-red-950/40 text-red-200 transition-colors hover:bg-red-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-red-400"
      >
        <span
          aria-hidden="true"
          className="absolute inset-0 inline-block animate-ping rounded-xl bg-red-500/30"
        />
        <SquareIcon size={11} />
      </button>
    );
  }
  const label = mode === "regenerate" ? "Regenerate" : "Send";
  const title = mode === "regenerate" ? `Regenerate (${KBD})` : `Send (${KBD})`;
  return (
    <button
      type="button"
      onClick={onGenerate}
      title={title}
      aria-label={label}
      className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-white transition-transform hover:-translate-y-px active:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40 ${theme.ctaGradient} ${theme.ctaHover} ${theme.ctaShadow}`}
    >
      {mode === "regenerate" ? <RegenerateIcon /> : <SendIcon size={14} />}
    </button>
  );
}

const ACTION_ICON: Record<
  Action,
  (props: { size?: number }) => JSX.Element
> = {
  reply: ReplyIcon,
  translate: TranslateIcon,
  grammar: GrammarIcon,
  rewrite: RewriteIcon,
};

// ---------------------------------------------------------------------------
// Local icons
// ---------------------------------------------------------------------------

function RegenerateIcon(): JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 0 0-15-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 15 6.7l3-2.7" />
      <path d="M21 21v-5h-5" />
    </svg>
  );
}
