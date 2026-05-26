// Bottom-sheet modal for per-request options.
//
// Mobile-app style: slides up from the bottom, takes most of the panel
// height, dims and blurs the content behind, and traps focus inside until
// dismissed. The user's choices are applied live — the sheet is a viewing
// layer, not a form — so Done just closes it.
//
// A11y:
//   - aria-modal, aria-labelledby
//   - Escape closes
//   - First field auto-focuses on open
//   - Tab loops between focusable controls (manual focus trap so we don't
//     need a heavy dependency)
//   - Backdrop click closes; the panel itself stops propagation

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  Action,
  LANGUAGE_CATALOG,
  MODEL_CATALOG,
  ModelId,
  SourceLanguage,
  TONE_PRESETS,
  TONE_PRESET_LABELS,
  TonePreset,
  languageDisplayName,
} from "@inkwell/shared";
import type { TargetChoice } from "../lib/ui-state";
import { ArrowRightIcon, SlidersIcon, XIcon } from "./icons";

const MAX_INSTRUCTION = 1000;

const INSTRUCTION_PLACEHOLDERS: Record<Action, string> = {
  reply: "Optional: how to shape the reply (e.g. “agree, propose Friday 2pm”).",
  translate: "Optional: extra direction (e.g. “keep it formal”).",
  grammar: "Optional: extra direction (e.g. “keep the casual tone”).",
  rewrite:
    "Describe what to write, or how to rewrite the text. No text? Then this is your brief.",
};

export interface OptionsSheetProps {
  action: Action;
  sourceLang: SourceLanguage;
  onSourceLang: (v: SourceLanguage) => void;
  targetChoice: TargetChoice;
  onTargetChoice: (v: TargetChoice) => void;
  targetOptions: { value: string; label: string }[];
  tone: TonePreset;
  onTone: (v: TonePreset) => void;
  model: ModelId;
  onModel: (v: ModelId) => void;
  instruction: string;
  onInstruction: (v: string) => void;
  disabled: boolean;
  onClose: () => void;
}

export function OptionsSheet({
  action,
  sourceLang,
  onSourceLang,
  targetChoice,
  onTargetChoice,
  targetOptions,
  tone,
  onTone,
  model,
  onModel,
  instruction,
  onInstruction,
  disabled,
  onClose,
}: OptionsSheetProps): JSX.Element {
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Auto-focus the first interactive element and trap Tab inside the sheet.
  useEffect(() => {
    const focusables = (): HTMLElement[] => {
      if (!sheetRef.current) return [];
      return Array.from(
        sheetRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute("disabled"));
    };

    // Focus the first focusable on open (skip the close button — we want the
    // user landing on the actual content).
    const all = focusables();
    const first = all.find((el) => !el.hasAttribute("data-close")) ?? all[0];
    first?.focus();

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;
      const firstEl = list[0]!;
      const lastEl = list[list.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Lock body scroll while open so the page behind doesn't move.
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  const showTarget = action !== "grammar";
  const showToneRow = action !== "translate";
  const sourceLabel = action === "grammar" ? "Language" : "From";
  const targetLabel =
    action === "translate"
      ? "Translate to"
      : action === "reply"
        ? "Reply in"
        : "Output language";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
      className="absolute inset-0 z-40 flex flex-col justify-end bg-zinc-950/70 backdrop-blur-sm"
      style={{ animation: "sheet-fade 120ms ease-out" }}
    >
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88%] overflow-hidden rounded-t-3xl border border-b-0 border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/60"
        style={{
          // Subtle slide-up; uses a CSS animation defined inline because
          // tailwind doesn't ship a keyframe for this without a plugin.
          animation: "sheet-up 180ms ease-out",
        }}
      >
        <style>{SHEET_KEYFRAMES}</style>
        <div className="flex flex-col">
          <Handle />
          <Header titleId={titleId} onClose={onClose} />
          <div className="space-y-3 overflow-y-auto px-4 pb-3 pt-1">
            <LanguageRow
              showTarget={showTarget}
              sourceLabel={sourceLabel}
              targetLabel={targetLabel}
              sourceLang={sourceLang}
              onSourceLang={onSourceLang}
              targetChoice={targetChoice}
              onTargetChoice={onTargetChoice}
              targetOptions={targetOptions}
              disabled={disabled}
            />
            {showToneRow ? (
              <SettingsRow
                tone={tone}
                onTone={onTone}
                model={model}
                onModel={onModel}
                disabled={disabled}
              />
            ) : (
              <ModelOnlyRow
                model={model}
                onModel={onModel}
                disabled={disabled}
              />
            )}
            <InstructionInput
              placeholder={INSTRUCTION_PLACEHOLDERS[action]}
              value={instruction}
              onChange={onInstruction}
            />
          </div>
          <Footer onClose={onClose} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Handle(): JSX.Element {
  return (
    <div className="flex justify-center pb-1 pt-2.5" aria-hidden="true">
      <span className="h-1 w-9 rounded-full bg-zinc-700" />
    </div>
  );
}

function Header({
  titleId,
  onClose,
}: {
  titleId: string;
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between px-4 pb-2 pt-1">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-800/70 text-zinc-300">
          <SlidersIcon size={13} />
        </span>
        <h2
          id={titleId}
          className="text-[13.5px] font-semibold tracking-tight text-zinc-50"
        >
          Options
        </h2>
      </div>
      <button
        type="button"
        onClick={onClose}
        data-close
        aria-label="Close options"
        title="Close"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500"
      >
        <XIcon size={14} />
      </button>
    </div>
  );
}

function Footer({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <div className="border-t border-zinc-800 bg-zinc-900/80 p-3">
      <button
        type="button"
        onClick={onClose}
        className="inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-3 py-2 text-[12.5px] font-semibold text-white shadow-md shadow-indigo-950/30 transition-colors hover:from-indigo-400 hover:to-violet-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
      >
        Done
      </button>
    </div>
  );
}

function LanguageRow({
  showTarget,
  sourceLabel,
  targetLabel,
  sourceLang,
  onSourceLang,
  targetChoice,
  onTargetChoice,
  targetOptions,
  disabled,
}: {
  showTarget: boolean;
  sourceLabel: string;
  targetLabel: string;
  sourceLang: SourceLanguage;
  onSourceLang: (v: SourceLanguage) => void;
  targetChoice: TargetChoice;
  onTargetChoice: (v: TargetChoice) => void;
  targetOptions: { value: string; label: string }[];
  disabled: boolean;
}): JSX.Element {
  return (
    <div
      // `minmax(0, 1fr)` (not bare `1fr`) lets the columns actually shrink
      // below their content width, which is what makes the truncate +
      // text-overflow rules on the inner <select> kick in. Without it,
      // long language names (Malayalam, Portuguese (Brazil)) push the
      // grid wider than the sheet and the second column wraps under.
      className={`grid items-end gap-2 ${
        showTarget
          ? "grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"
          : "grid-cols-1"
      }`}
    >
      <SelectField
        label={sourceLabel}
        value={sourceLang}
        onChange={(v) => onSourceLang(v as SourceLanguage)}
        disabled={disabled}
      >
        <option value="auto">Auto-detect</option>
        {LANGUAGE_CATALOG.map((l) => (
          <option key={l.id} value={l.id}>
            {languageDisplayName(l.id)}
          </option>
        ))}
      </SelectField>
      {showTarget && (
        <span aria-hidden="true" className="pb-[9px] text-zinc-500">
          <ArrowRightIcon size={14} />
        </span>
      )}
      {showTarget && (
        <SelectField
          label={targetLabel}
          value={String(targetChoice)}
          onChange={(v) => onTargetChoice(v as TargetChoice)}
          disabled={disabled}
        >
          {targetOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </SelectField>
      )}
    </div>
  );
}

function SettingsRow({
  tone,
  onTone,
  model,
  onModel,
  disabled,
}: {
  tone: TonePreset;
  onTone: (v: TonePreset) => void;
  model: ModelId;
  onModel: (v: ModelId) => void;
  disabled: boolean;
}): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-2">
      <SelectField
        label="Tone"
        value={tone}
        onChange={(v) => onTone(v as TonePreset)}
        disabled={disabled}
      >
        {TONE_PRESETS.map((t) => (
          <option key={t} value={t}>
            {TONE_PRESET_LABELS[t]}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Model"
        value={model}
        onChange={(v) => onModel(v as ModelId)}
        disabled={disabled}
      >
        {MODEL_CATALOG.map((m) => (
          <option key={m.id} value={m.id} title={m.description}>
            {m.label}
          </option>
        ))}
      </SelectField>
    </div>
  );
}

function ModelOnlyRow({
  model,
  onModel,
  disabled,
}: {
  model: ModelId;
  onModel: (v: ModelId) => void;
  disabled: boolean;
}): JSX.Element {
  return (
    <SelectField
      label="Model"
      value={model}
      onChange={(v) => onModel(v as ModelId)}
      disabled={disabled}
    >
      {MODEL_CATALOG.map((m) => (
        <option key={m.id} value={m.id} title={m.description}>
          {m.label}
        </option>
      ))}
    </SelectField>
  );
}

function SelectField({
  label,
  value,
  onChange,
  disabled,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full appearance-none truncate rounded-lg border border-zinc-800 bg-zinc-950 bg-no-repeat py-2 pl-2.5 pr-7 text-[12.5px] font-medium text-zinc-100 transition-colors hover:border-zinc-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25 disabled:cursor-not-allowed disabled:opacity-55"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>\")",
          backgroundPosition: "right 8px center",
        }}
      >
        {children}
      </select>
    </label>
  );
}

function InstructionInput({
  placeholder,
  value,
  onChange,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Custom note
      </span>
      <div className="relative">
        <textarea
          dir="auto"
          rows={3}
          placeholder={placeholder}
          value={value}
          maxLength={MAX_INSTRUCTION}
          onChange={(e) => onChange(e.target.value)}
          className="block w-full resize-y rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-[13px] leading-relaxed text-zinc-100 placeholder-zinc-500 caret-indigo-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
        />
        <span className="pointer-events-none absolute bottom-1.5 right-2 rounded bg-zinc-950/80 px-1 text-[10px] text-zinc-500">
          {value.length}/{MAX_INSTRUCTION}
        </span>
      </div>
    </label>
  );
}

// Used to formulate a one-line summary chip outside the sheet — exposed
// here so the parent can render the chip without duplicating logic.
export function useOptionsSummary({
  action,
  sourceLang,
  targetChoice,
  tone,
  model,
  instruction,
}: {
  action: Action;
  sourceLang: SourceLanguage;
  targetChoice: TargetChoice;
  tone: TonePreset;
  model: ModelId;
  instruction: string;
}): string {
  return useMemo(() => {
    return summarise({
      action,
      sourceLang,
      targetChoice,
      tone,
      model,
      instruction,
    });
  }, [action, sourceLang, targetChoice, tone, model, instruction]);
}

function summarise({
  action,
  sourceLang,
  targetChoice,
  tone,
  model,
  instruction,
}: {
  action: Action;
  sourceLang: SourceLanguage;
  targetChoice: TargetChoice;
  tone: TonePreset;
  model: ModelId;
  instruction: string;
}): string {
  const parts: string[] = [];
  const srcShown =
    sourceLang === "auto"
      ? "Auto"
      : languageDisplayName(sourceLang).split(" ")[0]!;
  if (action === "grammar") {
    parts.push(srcShown);
  } else {
    let tgtShown = "";
    if (targetChoice === "match")
      tgtShown = action === "reply" ? "Customer's lang" : "Same as source";
    else if (targetChoice === "bilingual") tgtShown = "Bilingual";
    else tgtShown = languageDisplayName(targetChoice).split(" ")[0]!;
    parts.push(`${srcShown} → ${tgtShown}`);
  }
  if (action !== "translate") parts.push(TONE_PRESET_LABELS[tone]);
  const m = MODEL_CATALOG.find((x) => x.id === model);
  if (m) parts.push(m.label);
  if (instruction.trim()) parts.push("custom note");
  return parts.join(" · ");
}

// Inline keyframes so we don't need a Tailwind plugin for the slide-up
// and backdrop fade-in. MV3 extension_pages CSP allows inline <style>.
const SHEET_KEYFRAMES = `
@keyframes sheet-up {
  from { transform: translateY(12%); opacity: 0.6; }
  to { transform: translateY(0); opacity: 1; }
}
@keyframes sheet-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
`;
