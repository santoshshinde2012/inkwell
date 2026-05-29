// In-page popover. Vanilla DOM (no React) so the in-content bundle stays
// small. Mounted inside the closed Shadow DOM the trigger created.
//
// UX principles enforced here:
//   • Works on a field OR a selection OR typed-in text (see PopoverSource).
//   • Persistent DOM. We never blow away innerHTML on state changes — that
//     would steal focus from the textarea mid-typing. Instead we cache
//     element refs and mutate the smallest subtree that changed.
//   • Keyboard-first. Esc closes; Cmd/Ctrl+Enter generates, then inserts
//     (field) or copies (selection); outside-click also dismisses.
//   • Streaming feedback. While tokens arrive, a pulsing caret follows the
//     last character so the user sees progress at a glance.
//   • Output handling. In field mode the result can be inserted ("Reply"
//     at the cursor; Grammar/Rewrite replace the field) — and copied. In
//     selection / blank mode it is copy-only: we never write to the page.
//   • Accessible. role="dialog" + aria-labelledby + aria-live="polite" on
//     the streaming preview. Non-modal (aria-modal="false") — initial focus
//     lands on the primary input, and focus returns to the source field on
//     a successful insert. Esc closes; Cmd/Ctrl+Enter generates.
//   • Dark-mode aware via prefers-color-scheme.

import {
  Action,
  RequestContext,
  TonePreset,
  TONE_PRESETS,
  TONE_PRESET_LABELS,
  ModelId,
  DEFAULT_MODEL_ID,
  MESSAGE_TYPES,
  CompleteStartMessage,
  CompleteCancelMessage,
  CompleteTokenMessage,
  CompleteDoneMessage,
  CompleteErrorMessage,
  CompleteUsageMessage,
  LanguageId,
  SourceLanguage,
  LANGUAGE_CATALOG,
  DEFAULT_WORKING_LANGUAGE,
  getLanguageInfo,
  isLanguageId,
  languageDisplayName,
  languageLabel,
  type RemoteModelInfo,
} from "@inkwell/shared";
import { ExtensionContextInvalidatedError, sendToBackground } from "../lib/messaging";
import { localStore } from "../lib/storage";
import { detectLanguage } from "../lib/languages";
import { historyStore, type NewHistoryEntry } from "../lib/history";
import { loadModelCatalog } from "../lib/models";
import { makeUuid } from "../lib/uuid";
import { readText, writeText } from "./editable";
import {
  decideDefaultActionWithDetection,
  type DefaultActionSource,
} from "../lib/default-action";
import type { SiteAdapter } from "./adapters";

import {
  loadOptsExpanded,
  saveOptsExpanded,
  loadLastUsed,
  saveLastUsed,
  isValidAction,
  isValidTone,
  isValidModel,
  isValidSourceLang,
  isValidTargetChoice,
  type TargetChoice,
} from "../lib/ui-state";

// Where the text Inkwell works on comes from. This is what makes the
// popover usable both inside editable fields AND on read-only page text:
//
//   field     — an editable element. The result can be inserted back.
//   selection — text the user highlighted anywhere on the page. Read-only,
//               so the result is copy-only (we never write to the page).
//   blank     — opened with nothing focused/selected; the user types the
//               text into the popover themselves.
export type PopoverSource =
  | { kind: "field"; element: HTMLElement }
  | { kind: "selection"; text: string }
  | { kind: "blank" };

interface MountArgs {
  shadow: ShadowRoot;
  /** Viewport rect the popover positions itself against. */
  anchorRect: DOMRect;
  source: PopoverSource;
  adapter: SiteAdapter;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Static catalogs + styles — extracted to keep this file focused on DOM
// construction. SVG icons + per-action labels live in ./popover.icons;
// the popover's CSS lives in ./popover.styles.
// ---------------------------------------------------------------------------
import {
  ACTION_HINTS,
  ACTION_ICONS,
  ACTION_LABELS,
  ICON_ARROW_RIGHT,
  ICON_CHECK,
  ICON_CHEVRON_DOWN,
  ICON_COPY,
  ICON_DROP,
  ICON_GRIP,
  ICON_PANEL_RIGHT,
  ICON_REFRESH,
  ICON_SLIDERS,
  ICON_SQUARE,
  ICON_X,
  INSTRUCTION_PLACEHOLDERS,
  SOURCE_LABELS,
  SOURCE_PLACEHOLDERS,
} from "./popover.icons";
import { POPOVER_STYLES } from "./popover.styles";
import { attachHeaderDrag } from "./popover.drag";
import { createLanguageDetector } from "./popover.detect";

// ---------------------------------------------------------------------------
// Positioning. Tries below the field; flips above if there's more room there.
// Stays inside the viewport with an 8px margin on every side.
// ---------------------------------------------------------------------------

const positionPopover = (el: HTMLElement, rect: DOMRect): void => {
  const margin = 8;
  const popH = el.offsetHeight || 360;
  const popW = el.offsetWidth || 420;
  const spaceBelow = window.innerHeight - rect.bottom - margin;
  const spaceAbove = rect.top - margin;

  let top: number;
  if (spaceBelow >= popH + margin || spaceBelow >= spaceAbove) {
    top = Math.max(margin, rect.bottom + 8);
  } else {
    top = Math.max(margin, rect.top - popH - 8);
  }

  let left = rect.left;
  // keep on screen
  left = Math.min(window.innerWidth - popW - margin, Math.max(margin, left));
  // also keep below viewport bottom
  if (top + popH > window.innerHeight - margin) {
    top = Math.max(margin, window.innerHeight - popH - margin);
  }

  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
};

// ---------------------------------------------------------------------------
// The popover itself.
// ---------------------------------------------------------------------------

const KBD_SHORTCUT_HINT = navigator.platform.includes("Mac") ? "⌘↵" : "Ctrl+↵";
const KBD_SHORTCUT_FULL = navigator.platform.includes("Mac")
  ? "Press ⌘↵ to generate"
  : "Press Ctrl+↵ to generate";

const MAX_INSTRUCTION = 1000;

interface State {
  action: Action;
  tone: TonePreset;
  model: ModelId;
  instruction: string;
  streaming: boolean;
  preview: string;
  streamId: string | null;
  error: string | null;
  /** When set, the error UI also shows a recovery CTA. `refresh` means
   *  the extension was reloaded and this page needs a refresh to keep
   *  using Inkwell. */
  errorAction: "refresh" | null;
  usageMeta: string;
  hasOutput: boolean;
  // Language controls.
  sourceLang: SourceLanguage; // "auto" or an explicit language id
  detectedLang: LanguageId | null; // result of auto-detection (UI hint only)
  targetChoice: TargetChoice; // the "To" picker value
  // Whether the Options disclosure (language + tone/model + instruction)
  // is expanded. Collapsed by default so the popover's primary surface is
  // just text in → result out; persisted across opens.
  optionsExpanded: boolean;
}

// Persistence helpers (optsExpanded, lastUsed, validators, TargetChoice
// type) live in ../lib/ui-state and are shared with the Side Panel so both
// surfaces open in sync.

export const mountPopover = async ({
  shadow,
  anchorRect,
  source,
  adapter,
  onClose,
}: MountArgs): Promise<void> => {
  // Read the source's text synchronously so language detection can
  // run in parallel with the storage round-trips below — saves us an
  // event-loop turn between first paint and the language-aware initial
  // action. ``readText`` handles <input>/<textarea>/contenteditable
  // uniformly; selection mode already carries the text on the source.
  const initialActionContextText: string =
    source.kind === "selection"
      ? source.text
      : source.kind === "field"
        ? readText(source.element)
        : "";
  const initialActionSource: DefaultActionSource = source.kind === "field" ? "field" : "page";

  // Load every piece of persisted UI state in parallel before any DOM is
  // built, so the popover paints in its final shape — correct action,
  // tone, model, language pair, working-language defaults, and expanded/
  // collapsed disclosure — with no flicker on first frame. The combined
  // chrome.storage.local round-trip resolves in a handful of milliseconds,
  // fast enough to keep the open feeling instant.
  //
  // CLD detection joins the parallel barrier so the initial action
  // can be picked based on Chrome's actual language guess rather than
  // a Latin-script heuristic that would misread short French / Spanish
  // / German text as English. Detection bails on short / low-
  // confidence text by resolving to null, which the decider folds
  // back into the heuristic — no extra branching here.
  const [initialOptsExpanded, lastUsed, settings, modelCatalog, initialDetection] =
    await Promise.all([
      loadOptsExpanded(),
      loadLastUsed(),
      localStore.getAll().catch(() => null),
      // Read from the cache only — content scripts run in arbitrary
      // page origins and can't be trusted to call the backend. The
      // background worker keeps the cache fresh on its own schedule.
      loadModelCatalog(),
      initialActionContextText.trim()
        ? detectLanguage(initialActionContextText).catch(() => null)
        : Promise.resolve(null),
    ]);
  const modelOptions: readonly RemoteModelInfo[] = modelCatalog.models;

  // field mode inserts the result back; selection/blank are copy-only.
  const canInsert = source.kind === "field";

  // Resolve initial values with precedence:
  //   validated lastUsed > options-page default > built-in default.
  const defaultTone: TonePreset = settings?.defaultTone ?? TONE_PRESETS[0]!;
  // Pick the user's default if still present in the live catalog; otherwise
  // fall back to whatever the backend reports as default; finally the
  // bundled DEFAULT_MODEL_ID. Keeps the picker functional after a model
  // is retired upstream.
  const knownIds = new Set(modelOptions.map((m) => m.id));
  const defaultModel: ModelId =
    settings?.defaultModel && knownIds.has(settings.defaultModel)
      ? settings.defaultModel
      : (modelCatalog.default ?? DEFAULT_MODEL_ID);
  const workingLanguage: LanguageId = settings?.workingLanguage ?? DEFAULT_WORKING_LANGUAGE;
  const frequentLanguages: LanguageId[] = settings?.frequentLanguages ?? [];

  // Context-aware initial action — when the popover opens with text
  // already in scope (field with a draft, or page selection), pick a
  // default that matches the surface and language:
  //   non-English             → "translate"
  //   English from a field    → "grammar"
  //   English from a selection → "reply"
  //
  // We prefer Chrome's CLD verdict (fetched in parallel above) and
  // fall back to a sync Latin-script heuristic for short or
  // low-confidence text. Blank sources, or fields the user hasn't
  // typed into yet, keep ``lastUsed.action`` so a returning user
  // picks up where they left off.
  const initialAction: Action = initialActionContextText.trim()
    ? decideDefaultActionWithDetection({
        text: initialActionContextText,
        source: initialActionSource,
        detection: initialDetection,
      })
    : isValidAction(lastUsed.action)
      ? lastUsed.action
      : "reply";
  const initialTone: TonePreset = isValidTone(lastUsed.tone) ? lastUsed.tone : defaultTone;
  // `lastUsed.model` only counts when it exists in the live catalog —
  // an id retired upstream shouldn't keep getting sent.
  const initialModel: ModelId =
    isValidModel(lastUsed.model) && knownIds.has(lastUsed.model) ? lastUsed.model : defaultModel;
  const initialSourceLang: SourceLanguage = isValidSourceLang(lastUsed.sourceLang)
    ? lastUsed.sourceLang
    : "auto";
  const initialTargetChoice: TargetChoice = isValidTargetChoice(lastUsed.targetChoice)
    ? lastUsed.targetChoice
    : "match";
  // ---- Style block (idempotent) ------------------------------------------
  shadow.querySelector("style[data-inkwell-popover]")?.remove();
  const style = document.createElement("style");
  style.setAttribute("data-inkwell-popover", "");
  style.textContent = POPOVER_STYLES;
  shadow.appendChild(style);

  // ---- Build static DOM once ---------------------------------------------
  const root = document.createElement("div");
  root.className = "pop";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "false");
  root.setAttribute("aria-labelledby", "inkwell-pop-title");
  root.tabIndex = -1;

  // Header. The bar itself doubles as a drag handle (see drag wiring below)
  // — a grip glyph on the left reveals the affordance on hover.
  const head = document.createElement("div");
  head.className = "head";
  head.title = "Drag to move";
  const grip = document.createElement("span");
  grip.className = "grip";
  grip.setAttribute("aria-hidden", "true");
  grip.innerHTML = ICON_GRIP;
  const brand = document.createElement("span");
  brand.className = "brand-icon";
  brand.innerHTML = ICON_DROP;
  const titleWrap = document.createElement("div");
  const title = document.createElement("div");
  title.id = "inkwell-pop-title";
  title.className = "title";
  title.textContent = "Inkwell";
  const titleSub = document.createElement("div");
  titleSub.className = "title-sub";
  titleSub.textContent =
    source.kind === "selection"
      ? "Working on your selection"
      : source.kind === "blank"
        ? "Enter text below"
        : adapter.site === "generic"
          ? "Ready"
          : `On ${adapter.site}`;
  titleWrap.append(title, titleSub);
  const headSpacer = document.createElement("div");
  headSpacer.className = "head-spacer";
  const expandBtn = document.createElement("button");
  expandBtn.type = "button";
  expandBtn.className = "icon-btn";
  expandBtn.setAttribute("aria-label", "Open in side panel");
  expandBtn.title = "Open in side panel";
  expandBtn.innerHTML = ICON_PANEL_RIGHT;
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "icon-btn";
  closeBtn.setAttribute("aria-label", "Close (Esc)");
  closeBtn.title = "Close (Esc)";
  closeBtn.innerHTML = ICON_X;
  head.append(grip, brand, titleWrap, headSpacer, expandBtn, closeBtn);

  // Body
  const body = document.createElement("div");
  body.className = "body";

  // Action segmented control
  const actions = document.createElement("div");
  actions.className = "actions";
  actions.setAttribute("role", "tablist");
  actions.setAttribute("aria-label", "Action");
  const actionButtons: Record<Action, HTMLButtonElement> = {
    reply: createActionButton("reply"),
    translate: createActionButton("translate"),
    grammar: createActionButton("grammar"),
    rewrite: createActionButton("rewrite"),
  };
  actions.append(
    actionButtons.reply,
    actionButtons.translate,
    actionButtons.grammar,
    actionButtons.rewrite,
  );

  const actionHint = document.createElement("p");
  actionHint.className = "action-hint";

  // "Your text" box — the subject text for selection / blank mode. In
  // field mode the text is read from the page field, so this stays hidden.
  const sourceWrap = document.createElement("div");
  sourceWrap.className = "source-wrap";
  const sourceLabel = document.createElement("label");
  sourceLabel.className = "lang-field-label";
  sourceLabel.htmlFor = "inkwell-source";
  const sourceEl = document.createElement("textarea");
  sourceEl.className = "source";
  sourceEl.id = "inkwell-source";
  sourceEl.spellcheck = true;
  sourceEl.rows = 3;
  // dir="auto" so a right-to-left customer message (e.g. Arabic) pasted
  // here renders correctly.
  sourceEl.dir = "auto";
  if (source.kind === "selection") sourceEl.value = source.text;
  sourceWrap.append(sourceLabel, sourceEl);
  if (canInsert) sourceWrap.style.display = "none";

  // Language row — "From" (source) and "To" (target) pickers. The target
  // picker is rebuilt per action by renderLanguageControls() and hidden
  // entirely for grammar (which never translates).
  const langRow = document.createElement("div");
  langRow.className = "lang-row";

  const sourceField = document.createElement("div");
  sourceField.className = "lang-field";
  const sourceFieldLabel = document.createElement("span");
  sourceFieldLabel.className = "lang-field-label";
  const sourceLabelText = document.createElement("span");
  sourceLabelText.textContent = "From";
  const sourceDetected = document.createElement("span");
  sourceDetected.className = "lang-detected";
  sourceFieldLabel.append(sourceLabelText, sourceDetected);
  const sourceSelect = document.createElement("select");
  sourceSelect.className = "lang-select";
  sourceSelect.setAttribute("aria-label", "Source language");
  {
    const autoOpt = document.createElement("option");
    autoOpt.value = "auto";
    autoOpt.textContent = "Auto-detect";
    sourceSelect.appendChild(autoOpt);
  }
  for (const l of LANGUAGE_CATALOG) {
    const opt = document.createElement("option");
    opt.value = l.id;
    opt.textContent = languageDisplayName(l.id);
    sourceSelect.appendChild(opt);
  }
  sourceField.append(sourceFieldLabel, sourceSelect);

  const langArrow = document.createElement("span");
  langArrow.className = "lang-arrow";
  langArrow.setAttribute("aria-hidden", "true");
  langArrow.innerHTML = ICON_ARROW_RIGHT;

  const targetField = document.createElement("div");
  targetField.className = "lang-field";
  const targetFieldLabel = document.createElement("span");
  targetFieldLabel.className = "lang-field-label";
  const targetSelect = document.createElement("select");
  targetSelect.className = "lang-select";
  targetSelect.setAttribute("aria-label", "Output language");
  targetField.append(targetFieldLabel, targetSelect);

  langRow.append(sourceField, langArrow, targetField);

  // Settings row — tone + model as compact selects that match the language
  // pickers, so every configuration control in the popover is the same kind
  // of widget rather than a mix of pills, dropdowns, and rows.
  const settingsRow = document.createElement("div");
  settingsRow.className = "lang-row";

  const toneField = document.createElement("div");
  toneField.className = "lang-field";
  const toneFieldLabel = document.createElement("label");
  toneFieldLabel.className = "lang-field-label";
  toneFieldLabel.textContent = "Tone";
  toneFieldLabel.htmlFor = "inkwell-tone-select";
  const toneSelect = document.createElement("select");
  toneSelect.className = "lang-select";
  toneSelect.id = "inkwell-tone-select";
  toneSelect.setAttribute("aria-label", "Tone");
  for (const t of TONE_PRESETS) {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = TONE_PRESET_LABELS[t];
    toneSelect.appendChild(opt);
  }
  toneField.append(toneFieldLabel, toneSelect);

  // Model selector — populated from the shared catalog. The option text is
  // just the short label ("GPT-4o mini"); the full description rides along
  // as a title tooltip rather than being truncated inside the control.
  const modelField = document.createElement("div");
  modelField.className = "lang-field";
  const modelLabel = document.createElement("label");
  modelLabel.className = "lang-field-label";
  modelLabel.textContent = "Model";
  modelLabel.htmlFor = "inkwell-model-select";
  const modelSelect = document.createElement("select");
  modelSelect.className = "lang-select";
  modelSelect.id = "inkwell-model-select";
  modelSelect.setAttribute("aria-label", "Model");
  for (const m of modelOptions) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.label;
    opt.title = m.description;
    modelSelect.appendChild(opt);
  }
  modelField.append(modelLabel, modelSelect);

  settingsRow.append(toneField, modelField);

  // Instruction
  const instructionWrap = document.createElement("div");
  instructionWrap.className = "instruction-wrap";
  const instructionEl = document.createElement("textarea");
  instructionEl.className = "instruction";
  instructionEl.rows = 2;
  instructionEl.spellcheck = true;
  instructionEl.setAttribute("aria-label", "Instruction");
  instructionEl.maxLength = MAX_INSTRUCTION;
  const charCount = document.createElement("span");
  charCount.className = "char-count";
  charCount.setAttribute("aria-live", "off");
  instructionWrap.append(instructionEl, charCount);

  // Preview
  const previewWrap = document.createElement("div");
  previewWrap.className = "preview-wrap";
  previewWrap.setAttribute("data-state", "empty");
  const previewEl = document.createElement("div");
  previewEl.className = "preview preview-empty";
  previewEl.setAttribute("aria-live", "polite");
  previewEl.setAttribute("aria-atomic", "false");
  // dir="auto" so right-to-left output (Arabic, etc.) renders correctly.
  previewEl.dir = "auto";
  previewWrap.append(previewEl);

  const errEl = document.createElement("div");
  errEl.className = "err";
  errEl.style.display = "none";
  errEl.setAttribute("role", "alert");

  // ---- Options disclosure ------------------------------------------------
  // Wraps language + tone/model + the optional instruction so the popover's
  // primary surface stays focused on the use case (text in → result out).
  // Collapsed by default; expand to reveal the configuration controls. The
  // expanded/collapsed state and a one-line summary of the current settings
  // are persisted across popover opens.
  const optsSection = document.createElement("div");
  optsSection.className = "opts";

  const optsToggle = document.createElement("button");
  optsToggle.type = "button";
  optsToggle.className = "opts-toggle";
  optsToggle.setAttribute("aria-expanded", String(initialOptsExpanded));
  optsToggle.setAttribute("aria-controls", "inkwell-opts-body");
  // Sliders icon makes the disclosure read as "settings / configuration"
  // at a glance — clearer than text alone.
  const optsIcon = document.createElement("span");
  optsIcon.className = "opts-icon";
  optsIcon.setAttribute("aria-hidden", "true");
  optsIcon.innerHTML = ICON_SLIDERS;
  const optsText = document.createElement("span");
  optsText.className = "opts-text";
  optsText.textContent = "Options";
  const optsChevron = document.createElement("span");
  optsChevron.className = "opts-chevron";
  optsChevron.setAttribute("aria-hidden", "true");
  optsChevron.innerHTML = ICON_CHEVRON_DOWN;
  optsToggle.append(optsIcon, optsText, optsChevron);

  const optsBody = document.createElement("div");
  optsBody.className = "opts-body";
  optsBody.id = "inkwell-opts-body";
  const optsInner = document.createElement("div");
  optsInner.className = "opts-inner";
  optsInner.append(langRow, settingsRow, instructionWrap);
  optsBody.append(optsInner);

  optsSection.append(optsToggle, optsBody);

  body.append(actions, actionHint, sourceWrap, optsSection, previewWrap, errEl);

  // Footer
  const footer = document.createElement("div");
  footer.className = "footer";
  const meta = document.createElement("div");
  meta.className = "meta";
  const cancelBtn = createButton("Cancel", "btn-secondary", ICON_SQUARE);
  cancelBtn.style.display = "none";
  const regenBtn = createButton("Regenerate", "btn-secondary", ICON_REFRESH);
  regenBtn.style.display = "none";
  // Copy is shown alongside Insert in field mode, and is the primary
  // action in selection / blank mode (where there's nothing to insert into).
  const copyBtn = createButton("Copy", "btn-secondary", ICON_COPY);
  copyBtn.style.display = "none";
  const primaryBtn = createButton("Generate", "btn-primary accent", ICON_ARROW_RIGHT);
  primaryBtn.setAttribute("aria-keyshortcuts", "Meta+Enter");
  footer.append(meta, regenBtn, cancelBtn, copyBtn, primaryBtn);

  root.append(head, body, footer);
  shadow.appendChild(root);

  // First paint, then position (so offsetHeight is available).
  requestAnimationFrame(() => positionPopover(root, anchorRect));

  // ---- State -------------------------------------------------------------
  const state: State = {
    action: initialAction,
    tone: initialTone,
    model: initialModel,
    instruction: "",
    streaming: false,
    preview: "",
    streamId: null,
    error: null,
    errorAction: null,
    usageMeta: KBD_SHORTCUT_FULL,
    hasOutput: false,
    sourceLang: initialSourceLang,
    detectedLang: null,
    targetChoice: initialTargetChoice,
    optionsExpanded: initialOptsExpanded,
  };
  modelSelect.value = state.model;

  // Carries the metadata of the in-flight request so a finished stream can
  // be written to history (which needs both the input and the output text).
  let pendingHistory: NewHistoryEntry | null = null;

  // ---- Bindings (these update only the elements that depend on each var)
  const renderActionVisuals = (): void => {
    for (const a of Object.keys(actionButtons) as Action[]) {
      const selected = a === state.action;
      actionButtons[a].setAttribute("aria-selected", String(selected));
      actionButtons[a].tabIndex = selected ? 0 : -1;
    }
    actionHint.textContent = ACTION_HINTS[state.action];
    instructionEl.placeholder = INSTRUCTION_PLACEHOLDERS[state.action];
    sourceLabel.textContent = SOURCE_LABELS[state.action];
    sourceEl.placeholder = SOURCE_PLACEHOLDERS[state.action];
    // Tone has no effect on a faithful translation — hide the control for
    // translate so the settings row only shows what actually applies.
    toneField.style.display = state.action === "translate" ? "none" : "";
  };

  // Language ids ordered so the agent's frequently-used languages come
  // first in the pickers, then the rest of the catalog.
  const orderedLanguages = (): LanguageId[] => {
    const freq = frequentLanguages.filter((id) => getLanguageInfo(id));
    const rest = LANGUAGE_CATALOG.map((l) => l.id).filter((id) => !freq.includes(id));
    return [...freq, ...rest];
  };

  // (Re)build the "To" picker's options for the current action.
  const buildTargetOptions = (): void => {
    targetSelect.replaceChildren();
    const addOption = (value: string, label: string): void => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      targetSelect.appendChild(opt);
    };
    const addLanguageOptions = (): void => {
      const ids = orderedLanguages();
      const freqCount = frequentLanguages.length;
      // Group into "Frequent" + "All languages" only when that split is
      // meaningful (some, but not all, languages are marked frequent).
      if (freqCount > 0 && freqCount < ids.length) {
        const frequentGroup = document.createElement("optgroup");
        frequentGroup.label = "Frequent";
        const allGroup = document.createElement("optgroup");
        allGroup.label = "All languages";
        ids.forEach((id, i) => {
          const opt = document.createElement("option");
          opt.value = id;
          opt.textContent = languageDisplayName(id);
          (i < freqCount ? frequentGroup : allGroup).appendChild(opt);
        });
        targetSelect.append(frequentGroup, allGroup);
      } else {
        for (const id of ids) addOption(id, languageDisplayName(id));
      }
    };

    if (state.action === "translate") {
      addLanguageOptions();
    } else if (state.action === "reply") {
      addOption("match", "Customer's language");
      addOption("bilingual", `Bilingual (+ ${languageLabel(workingLanguage)})`);
      addLanguageOptions();
    } else {
      // rewrite
      addOption("match", "Keep source language");
      addLanguageOptions();
    }
  };

  // Sync the whole language row to state: the detected-language hint, the
  // visible/hidden "To" field, its option set, and the two select values.
  const renderLanguageControls = (): void => {
    // Grammar has no "To" field, so "Language" reads better than "From".
    sourceLabelText.textContent = state.action === "grammar" ? "Language" : "From";
    if (state.sourceLang === "auto") {
      sourceDetected.textContent = state.detectedLang
        ? ` · ${languageLabel(state.detectedLang)}`
        : "";
    } else {
      sourceDetected.textContent = "";
    }
    sourceSelect.value = state.sourceLang;

    // Grammar never translates — there is no target language to pick.
    const showTarget = state.action !== "grammar";
    targetField.style.display = showTarget ? "" : "none";
    langArrow.style.display = showTarget ? "" : "none";
    if (!showTarget) return;

    targetFieldLabel.textContent =
      state.action === "translate"
        ? "Translate to"
        : state.action === "reply"
          ? "Reply in"
          : "Output language";

    buildTargetOptions();

    // Coerce targetChoice to a value that actually exists in the rebuilt
    // option list (e.g. after switching away from a "bilingual" reply).
    const wanted = String(state.targetChoice);
    const exists = Array.from(targetSelect.options).some((o) => o.value === wanted);
    if (!exists) {
      state.targetChoice = state.action === "translate" ? workingLanguage : "match";
    }
    targetSelect.value = String(state.targetChoice);
  };

  const renderToneVisuals = (): void => {
    toneSelect.value = state.tone;
  };

  const renderCharCount = (): void => {
    const len = state.instruction.length;
    charCount.textContent = `${len}/${MAX_INSTRUCTION}`;
    charCount.classList.toggle("warn", len > MAX_INSTRUCTION * 0.9 && len <= MAX_INSTRUCTION);
    charCount.classList.toggle("over", len > MAX_INSTRUCTION);
  };

  const renderPreviewState = (): void => {
    if (state.error) {
      previewWrap.dataset["state"] = "error";
    } else if (state.streaming) {
      previewWrap.dataset["state"] = "streaming";
    } else if (state.preview) {
      previewWrap.dataset["state"] = "ready";
    } else {
      previewWrap.dataset["state"] = "empty";
    }

    if (state.preview) {
      previewEl.classList.remove("preview-empty");
      previewEl.classList.toggle("caret", state.streaming);
      previewEl.textContent = state.preview;
      previewWrap.scrollTop = previewWrap.scrollHeight;
    } else if (state.streaming) {
      // Streaming has started but no token has landed yet — an animated
      // indicator reads as "working" far better than static text.
      previewEl.classList.remove("preview-empty", "caret");
      previewEl.replaceChildren(buildThinkingIndicator());
    } else {
      previewEl.classList.add("preview-empty");
      previewEl.classList.remove("caret");
      previewEl.textContent = "Your result will appear here.";
    }

    if (state.error) {
      errEl.style.display = "";
      errEl.innerHTML = "";
      const icon = document.createElement("span");
      icon.innerHTML = ICON_X;
      const msg = document.createElement("span");
      msg.textContent = state.error;
      errEl.append(icon, msg);
      if (state.errorAction === "refresh") {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "Refresh page";
        btn.className = "inkwell-error-cta";
        btn.addEventListener("click", () => window.location.reload());
        errEl.append(btn);
      }
    } else {
      errEl.style.display = "none";
    }
  };

  // Whether the result can be written back into the page. Field mode allows
  // it — except for "translate", whose output is a rendering of someone
  // else's message, not something you'd paste into your own draft.
  const insertable = (): boolean => source.kind === "field" && state.action !== "translate";

  const renderFooter = (): void => {
    meta.textContent = state.usageMeta;
    // Settings can't change mid-stream — lock every control while streaming.
    modelSelect.disabled = state.streaming;
    toneSelect.disabled = state.streaming;
    sourceSelect.disabled = state.streaming;
    targetSelect.disabled = state.streaming;
    const ready = state.hasOutput && !!state.preview && !state.error;
    if (state.streaming) {
      cancelBtn.style.display = "";
      regenBtn.style.display = "none";
      copyBtn.style.display = "none";
      primaryBtn.style.display = "none";
    } else if (ready) {
      // There's a result. Regenerate is always offered. When the result can
      // be inserted, that is the primary action (with Copy secondary);
      // otherwise Copy is the primary action.
      cancelBtn.style.display = "none";
      regenBtn.style.display = "";
      primaryBtn.style.display = "";
      primaryBtn.classList.remove("accent");
      primaryBtn.classList.add("btn-primary");
      if (insertable()) {
        copyBtn.style.display = "";
        setButtonLabel(primaryBtn, "Insert", ICON_CHECK);
      } else {
        copyBtn.style.display = "none";
        setButtonLabel(primaryBtn, "Copy", ICON_COPY);
      }
    } else {
      cancelBtn.style.display = "none";
      regenBtn.style.display = "none";
      copyBtn.style.display = "none";
      primaryBtn.style.display = "";
      setButtonLabel(primaryBtn, "Generate", ICON_ARROW_RIGHT);
      primaryBtn.classList.add("accent");
    }
  };

  // Inline summary appended to "Options · …" in the disclosure header. Lets
  // the user verify the language pair, tone (where it applies), model, and
  // whether a custom instruction is set — without having to expand.
  const computeOptsSummary = (): string => {
    const parts: string[] = [];
    const srcShown =
      state.sourceLang === "auto"
        ? state.detectedLang
          ? languageLabel(state.detectedLang)
          : "Auto"
        : languageLabel(state.sourceLang);

    if (state.action === "grammar") {
      parts.push(srcShown);
    } else {
      let tgtShown: string;
      if (state.targetChoice === "match") {
        tgtShown = state.action === "reply" ? "Customer's lang" : "Same as source";
      } else if (state.targetChoice === "bilingual") {
        tgtShown = "Bilingual";
      } else {
        tgtShown = languageLabel(state.targetChoice as LanguageId);
      }
      parts.push(`${srcShown} → ${tgtShown}`);
    }

    if (state.action !== "translate") {
      parts.push(TONE_PRESET_LABELS[state.tone]);
    }
    const m = modelOptions.find((x) => x.id === state.model);
    if (m) parts.push(m.label);
    if (state.instruction.trim()) parts.push("custom note");

    return parts.join(" · ");
  };

  const renderOptionsToggle = (): void => {
    optsToggle.setAttribute("aria-expanded", String(state.optionsExpanded));
    optsText.textContent = `Options · ${computeOptsSummary()}`;
  };

  const renderAll = (): void => {
    renderActionVisuals();
    renderLanguageControls();
    renderToneVisuals();
    renderCharCount();
    renderPreviewState();
    renderFooter();
    renderOptionsToggle();
  };

  // ---- Language detection ------------------------------------------------
  // Detector lives in ./popover.detect — it owns the debounce timer +
  // the field-mode adapter cache. We give it read-only accessors for
  // the state it depends on, plus callbacks to write the detected
  // language back and re-render.
  const detector = createLanguageDetector({
    source,
    adapter,
    getAction: () => state.action,
    getSourceLang: () => state.sourceLang,
    setDetected: (lang) => {
      state.detectedLang = lang;
    },
    onChange: () => {
      renderLanguageControls();
      renderOptionsToggle();
    },
  });

  // The text an action operates on — used by the action's start()
  // closure further down to populate the history entry. The detector
  // has its own copy of this helper because it shouldn't know about
  // the history-entry side of the world.
  const subjectText = (ctx: RequestContext): string => {
    if (state.action === "grammar" || state.action === "rewrite") {
      return ctx.draft ?? "";
    }
    if (ctx.post) return ctx.post.text;
    if (ctx.thread && ctx.thread.length > 0) {
      return ctx.thread[ctx.thread.length - 1]?.text ?? "";
    }
    return ctx.draft ?? "";
  };

  // ---- Wire interactions -------------------------------------------------
  const setAction = (a: Action): void => {
    if (state.streaming || a === state.action) return;
    state.action = a;
    // Reset the "To" picker to a sensible default for the new action.
    if (a === "translate") {
      state.targetChoice = isLanguageId(state.targetChoice) ? state.targetChoice : workingLanguage;
    } else if (a !== "grammar") {
      // reply / rewrite default to matching the source language.
      state.targetChoice = "match";
    }
    // Switching action starts a fresh task: discard any prior result so the
    // footer never offers to insert/copy output produced by a different
    // action (a translation is not something you'd insert as a reply).
    state.preview = "";
    state.hasOutput = false;
    state.error = null;
    state.errorAction = null;
    state.usageMeta = KBD_SHORTCUT_FULL;
    pendingHistory = null;
    renderAll();
    // The subject text differs per action in field mode (incoming thread
    // vs. the draft), so refresh the detected-language badge.
    void detector.detectField();
    // Persist so the next popover opens on the same action.
    saveLastUsed(state);
  };
  for (const a of Object.keys(actionButtons) as Action[]) {
    actionButtons[a].addEventListener("click", () => setAction(a));
  }
  toneSelect.addEventListener("change", () => {
    // Option values come straight from TONE_PRESETS, so this is always valid.
    state.tone = toneSelect.value as TonePreset;
    renderOptionsToggle();
    saveLastUsed(state);
  });
  modelSelect.addEventListener("change", () => {
    // The <option> values come straight from the live catalog
    // (modelOptions, sourced from /api/v1/models), so the value is a
    // backend-recognised model id at the time the popover opened.
    state.model = modelSelect.value as ModelId;
    renderOptionsToggle();
    saveLastUsed(state);
  });
  sourceSelect.addEventListener("change", () => {
    // Values are "auto" or a catalog language id — both valid SourceLanguage.
    state.sourceLang = sourceSelect.value as SourceLanguage;
    if (state.sourceLang === "auto") {
      // Re-detect from whatever text is currently available.
      if (source.kind === "field") void detector.detectField();
      else void detector.scheduleFromText(sourceEl.value);
    }
    renderLanguageControls();
    renderOptionsToggle();
    saveLastUsed(state);
  });
  targetSelect.addEventListener("change", () => {
    // Values are "match", "bilingual", or a catalog language id.
    state.targetChoice = targetSelect.value as TargetChoice;
    renderOptionsToggle();
    saveLastUsed(state);
  });
  instructionEl.addEventListener("input", () => {
    state.instruction = instructionEl.value;
    renderCharCount();
    renderOptionsToggle();
  });

  // Expand/collapse the Options disclosure. The state is per-device and
  // persisted, so a user who routinely tweaks settings doesn't re-open it
  // every time the popover mounts.
  optsToggle.addEventListener("click", () => {
    state.optionsExpanded = !state.optionsExpanded;
    renderOptionsToggle();
    saveOptsExpanded(state.optionsExpanded);
  });

  sourceEl.addEventListener("input", () => {
    // Clearing a stale error as soon as the user edits the text feels
    // responsive; the next generate revalidates anyway. The refresh CTA
    // is the exception — editing doesn't fix an invalidated extension
    // context, so we keep it visible.
    if (state.error && state.errorAction !== "refresh") {
      state.error = null;
      state.errorAction = null;
      renderPreviewState();
    }
    if (state.sourceLang === "auto") detector.scheduleFromText(sourceEl.value);
  });

  closeBtn.addEventListener("click", () => teardown(false));

  // ---- Header drag handle -----------------------------------------------
  // Logic lives in ./popover.drag — it just reads / writes root.style.
  // The returned dispose() removes the listeners and releases any
  // in-flight pointer capture; we call it from teardown below.
  const detachDrag = attachHeaderDrag(head, root);

  // ---- "Open in side panel" handoff -------------------------------------
  // Sends the current source text + selected action to the background,
  // which opens the Side Panel for this tab and stashes the text. We
  // tear down on success so the popover doesn't linger over the page; on
  // failure (e.g. older Chrome without chrome.sidePanel.open) we surface
  // the error inline and leave the popover up.
  const handleExpand = async (): Promise<void> => {
    const text = sourceEl.value || (source.kind === "selection" ? source.text : "");
    try {
      const ack = await sendToBackground<{ ok: boolean; error?: { message?: string } }>({
        type: MESSAGE_TYPES.OPEN_SIDE_PANEL_FROM_POPOVER,
        text: text.trim() || undefined,
        action: state.action,
      });
      if (!ack?.ok) {
        state.error = ack?.error?.message ?? "Couldn't open the side panel.";
        state.errorAction = null;
        renderPreviewState();
        return;
      }
      teardown(false);
    } catch (err) {
      state.error = err instanceof Error ? err.message : "Couldn't open the side panel.";
      state.errorAction = null;
      renderPreviewState();
    }
  };
  expandBtn.addEventListener("click", () => void handleExpand());

  const ready = (): boolean => state.hasOutput && !!state.preview && !state.error;

  // `start()` is async; if anything in it rejects unexpectedly, the
  // bare `void` would silently swallow the rejection and the click would
  // appear to do nothing. `runStart` surfaces the failure as an inline
  // error so the user sees *something* instead of a dead button.
  const runStart = (): void => {
    start().catch((err: unknown) => {
      state.streaming = false;
      state.streamId = null;
      state.error = err instanceof Error ? err.message : "Couldn't start the request.";
      pendingHistory = null;
      renderAll();
      console.error("[inkwell] popover start() failed", err);
    });
  };

  primaryBtn.addEventListener("click", () => {
    if (state.streaming) return;
    if (!ready()) {
      runStart();
    } else if (insertable()) {
      insert();
    } else {
      void copyResult();
    }
  });
  copyBtn.addEventListener("click", () => void copyResult());
  regenBtn.addEventListener("click", runStart);
  cancelBtn.addEventListener("click", () => cancelStream());

  // Keyboard shortcuts (scoped to popover lifetime).
  const keydown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      teardown(false);
      return;
    }
    // Cmd/Ctrl+Enter: generate, then insert (field) or copy (selection).
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.stopPropagation();
      e.preventDefault();
      if (state.streaming) return;
      if (!ready()) runStart();
      else if (insertable()) insert();
      else void copyResult();
    }
  };
  // Listen on the shadow root so events from inside still fire; bubble
  // up to document for clicks landing on host page.
  const sRoot = shadow as unknown as ShadowRoot & { host?: HTMLElement };
  // Shadow doesn't dispatch keyboard events to document by default in a
  // closed shadow root; addEventListener on the host element catches them.
  if (sRoot.host) {
    sRoot.host.addEventListener("keydown", keydown, true);
  }
  // Also listen on the popover itself for in-shadow targets.
  root.addEventListener("keydown", keydown, true);

  // Outside-click closes (but not when click is inside the same shadow).
  const onDocClick = (e: MouseEvent): void => {
    // The popover lives in a CLOSED shadow root, so composedPath() does not
    // expose its internal nodes to this document-level listener — only the
    // shadow host. Testing `root` here can never match, which dismissed the
    // popover on every click inside it, Generate included. Match the host,
    // with the retargeted event.target (also the host) as a fallback.
    if (sRoot.host && e.composedPath().includes(sRoot.host)) return;
    const t = e.target;
    if (t instanceof Element && t.closest("[data-inkwell-root]")) return;
    teardown(false);
  };
  document.addEventListener("mousedown", onDocClick, true);

  // ---- Streaming wiring --------------------------------------------------
  const onStreamMessage = (msg: unknown): void => {
    if (!msg || typeof msg !== "object" || !("type" in msg)) return;
    const m = msg as
      | CompleteTokenMessage
      | CompleteDoneMessage
      | CompleteErrorMessage
      | CompleteUsageMessage;
    if ("streamId" in m && m.streamId !== state.streamId) return;

    switch (m.type) {
      case MESSAGE_TYPES.COMPLETE_TOKEN: {
        state.preview += (m as CompleteTokenMessage).delta;
        // Don't trigger a full re-render; just patch preview.
        if (previewEl.classList.contains("preview-empty")) {
          previewEl.classList.remove("preview-empty");
        }
        previewEl.classList.add("caret");
        previewEl.textContent = state.preview;
        previewWrap.dataset["state"] = "streaming";
        previewWrap.scrollTop = previewWrap.scrollHeight;
        return;
      }
      case MESSAGE_TYPES.COMPLETE_USAGE: {
        const u = (m as CompleteUsageMessage).usage;
        if (u) state.usageMeta = `${u.model ?? ""} · ${u.totalTokens ?? 0} tokens`;
        meta.textContent = state.usageMeta;
        return;
      }
      case MESSAGE_TYPES.COMPLETE_DONE: {
        state.streaming = false;
        state.streamId = null;
        state.hasOutput = true;
        // Record the completed action in the local, searchable history.
        if (pendingHistory && state.preview.trim()) {
          void historyStore.add({
            ...pendingHistory,
            outputText: state.preview,
          });
        }
        pendingHistory = null;
        renderAll();
        primaryBtn.focus();
        return;
      }
      case MESSAGE_TYPES.COMPLETE_ERROR: {
        const err = (m as CompleteErrorMessage).error;
        state.streaming = false;
        state.streamId = null;
        state.error = err.message || "Something went wrong";
        pendingHistory = null;
        renderAll();
        return;
      }
    }
  };
  chrome.runtime.onMessage.addListener(onStreamMessage);

  // ---- Actions -----------------------------------------------------------

  // Build the request context. In field mode the site adapter scrapes the
  // page; in selection/blank mode the text comes from the "your text" box.
  const buildContext = async (): Promise<RequestContext | { error: string }> => {
    if (source.kind === "field") {
      const ctx = await adapter.extractContext(source.element);
      const hasPageContext = !!(ctx.thread?.length || ctx.post);
      const hasDraft = !!(ctx.draft && ctx.draft.trim());
      // A field on a site with no adapter (or where the adapter found
      // nothing) yields no conversation to work from. Catch that here with
      // a clear, actionable message instead of letting the backend reject
      // it with a generic schema error.
      if (state.action === "reply" && !hasPageContext) {
        return {
          error:
            "Couldn't find a message to reply to on this page. Select the " +
            "customer's message, then click the Inkwell icon.",
        };
      }
      if (state.action === "translate" && !hasPageContext && !hasDraft) {
        return {
          error:
            "Nothing to translate here. Select the text you want translated, " +
            "then click the Inkwell icon.",
        };
      }
      if (state.action === "grammar" && !hasDraft) {
        return {
          error: "Type something in the field first, then fix its grammar.",
        };
      }
      if (state.action === "rewrite" && !hasDraft && !hasPageContext && !state.instruction.trim()) {
        return {
          error: "Type a draft to rewrite, or open Options to describe what " + "to write.",
        };
      }
      return ctx;
    }
    const text = sourceEl.value.trim();
    const instruction = state.instruction.trim();
    if (state.action === "reply" && !text) {
      return { error: "Add the text you want to reply to." };
    }
    if (state.action === "translate" && !text) {
      return { error: "Add the text you want to translate." };
    }
    if (state.action === "grammar" && !text) {
      return { error: "Add the text you want grammar-fixed." };
    }
    if (state.action === "rewrite" && !text && !instruction) {
      return {
        error: "Add text to rewrite, or open Options to describe what to write.",
      };
    }
    const base = {
      site: source.kind === "selection" ? "selection" : "manual",
      pageTitle: document.title.slice(0, 300),
      pageUrl: window.location.origin + window.location.pathname,
    };
    // 'reply' and 'translate' treat the text as an incoming message; the
    // other actions treat it as the draft to transform.
    return state.action === "reply" || state.action === "translate"
      ? { ...base, post: { text } }
      : { ...base, draft: text };
  };

  const start = async (): Promise<void> => {
    if (state.streaming) return;

    let ctx: RequestContext;
    try {
      const built = await buildContext();
      if ("error" in built) {
        state.error = built.error;
        // Auto-expand Options when the missing input lives there. Currently
        // that's the rewrite-without-text path — the instruction is hidden
        // in the collapsed disclosure, and silently expanding lets the user
        // act on the guidance without an extra click.
        if (state.action === "rewrite" && !state.instruction.trim()) {
          state.optionsExpanded = true;
          renderOptionsToggle();
          saveOptsExpanded(true);
        }
        renderPreviewState();
        renderFooter();
        return;
      }
      ctx = built;
    } catch (err: unknown) {
      state.error = err instanceof Error ? err.message : "Couldn't read the text.";
      renderPreviewState();
      renderFooter();
      return;
    }

    // Resolve the source language. An explicit pick wins; otherwise detect
    // it from the subject text so the request and the history entry are
    // both tagged with a concrete language.
    const subject = subjectText(ctx);
    if (state.sourceLang === "auto" && subject) {
      const detected = await detectLanguage(subject);
      if (detected) state.detectedLang = detected.language;
    }
    const sourceLanguage: SourceLanguage =
      state.sourceLang !== "auto" ? state.sourceLang : (state.detectedLang ?? "auto");

    // Resolve the target language + bilingual flag from the "To" picker.
    let targetLanguage: LanguageId | undefined;
    let bilingual = false;
    if (state.action === "translate") {
      targetLanguage = isLanguageId(state.targetChoice) ? state.targetChoice : workingLanguage;
    } else if (state.action === "reply" || state.action === "rewrite") {
      if (state.targetChoice === "bilingual") {
        bilingual = true;
        targetLanguage = workingLanguage;
      } else if (isLanguageId(state.targetChoice)) {
        targetLanguage = state.targetChoice;
      }
    }

    // Stash request metadata so a successful COMPLETE_DONE can record it.
    pendingHistory = {
      action: state.action,
      sourceLanguage,
      targetLanguage: targetLanguage ?? null,
      bilingual,
      inputText: subject,
      outputText: "",
      site: ctx.site ?? adapter.site,
      conversationUrl: ctx.pageUrl ?? window.location.origin + window.location.pathname,
      pageTitle: ctx.pageTitle ?? document.title,
    };

    state.preview = "";
    state.error = null;
    state.errorAction = null;
    state.usageMeta = "Streaming…";
    state.hasOutput = false;
    state.streaming = true;
    // `crypto.randomUUID` is secure-context-only; on http:// hosts the
    // content script's `window.crypto.randomUUID` is undefined and would
    // throw. `makeUuid` falls back to `getRandomValues` (available
    // everywhere) so the popover Generate button works on any host.
    state.streamId = makeUuid();
    renderAll();

    try {
      const startMsg: CompleteStartMessage = {
        type: MESSAGE_TYPES.COMPLETE_START,
        streamId: state.streamId,
        payload: {
          action: state.action,
          context: ctx,
          tone: state.tone,
          model: state.model,
          instruction: state.instruction.trim() || undefined,
          sourceLanguage,
          ...(targetLanguage ? { targetLanguage } : {}),
          ...(bilingual ? { bilingual: true } : {}),
        },
      };
      const ack = await sendToBackground<{ ok: boolean }>(startMsg);
      if (!ack?.ok) {
        state.streaming = false;
        state.streamId = null;
        state.error = "Backend rejected the request.";
        pendingHistory = null;
        renderAll();
      }
    } catch (err: unknown) {
      state.streaming = false;
      state.streamId = null;
      if (err instanceof ExtensionContextInvalidatedError) {
        state.error = err.message;
        state.errorAction = "refresh";
      } else {
        state.error = err instanceof Error ? err.message : "Failed to start.";
        state.errorAction = null;
      }
      pendingHistory = null;
      renderAll();
    }
  };

  const cancelStream = (): void => {
    if (!state.streamId) return;
    const cancelMsg: CompleteCancelMessage = {
      type: MESSAGE_TYPES.COMPLETE_CANCEL,
      streamId: state.streamId,
    };
    void sendToBackground(cancelMsg);
    state.streaming = false;
    state.streamId = null;
    state.usageMeta = "Cancelled";
    // A cancelled stream is not recorded in history.
    pendingHistory = null;
    renderAll();
  };

  // Insert the result back into the editable field (field mode only).
  const insert = (): void => {
    if (!state.preview || source.kind !== "field") return;
    if (state.action === "reply") {
      writeText(source.element, state.preview);
    } else {
      replaceFieldText(source.element, state.preview);
    }
    teardown(true);
  };

  // Write `text` to the clipboard via execCommand on a hidden textarea.
  // This is the primary copy path because, unlike navigator.clipboard, it
  // is NOT gated by the host page's Permissions-Policy and works reliably
  // from a content script inside a click gesture (navigator.clipboard is
  // blocked outright on some sites — Medium, for one). Returns false if
  // the copy did not take.
  const writeClipboard = (text: string): boolean => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  };

  // Copy the result to the clipboard. We never write to the page in
  // selection/blank mode — the user pastes it wherever they want. The
  // popover stays open so they can copy again or regenerate.
  let copyResetTimer = 0;
  const copyResult = async (): Promise<void> => {
    if (!state.preview) return;
    const target = insertable() ? copyBtn : primaryBtn;

    let ok = writeClipboard(state.preview);
    if (!ok) {
      // Fallback to the async Clipboard API (permissive pages still allow
      // it; the click gesture may already be spent, hence the fallback).
      try {
        await navigator.clipboard.writeText(state.preview);
        ok = true;
      } catch {
        ok = false;
      }
    }

    if (ok) {
      setButtonLabel(target, "Copied", ICON_CHECK);
      target.focus();
      window.clearTimeout(copyResetTimer);
      copyResetTimer = window.setTimeout(() => {
        setButtonLabel(target, "Copy", ICON_COPY);
      }, 1600);
    } else {
      state.error =
        "Couldn't copy to the clipboard. Select the text in the preview above and copy it manually.";
      renderPreviewState();
    }
  };

  const teardown = (insertedSuccessfully: boolean): void => {
    chrome.runtime.onMessage.removeListener(onStreamMessage);
    document.removeEventListener("mousedown", onDocClick, true);
    if (sRoot.host) sRoot.host.removeEventListener("keydown", keydown, true);
    root.removeEventListener("keydown", keydown, true);
    detachDrag();
    window.clearTimeout(copyResetTimer);
    detector.dispose();
    if (state.streamId) cancelStream();
    root.remove();
    style.remove();
    onClose();
    if (insertedSuccessfully && source.kind === "field") {
      source.element.focus();
    }
  };

  // Initial render + focus. In selection / blank mode focus the "your
  // text" box (it's the primary input); in field mode focus the
  // instruction box. Deferred past the entrance animation.
  renderAll();
  setTimeout(() => (canInsert ? instructionEl : sourceEl).focus(), 30);

  // Populate the "From" badge as soon as the popover opens — from the
  // selected/typed text, or by reading the focused field and its
  // surrounding conversation.
  if (source.kind === "field") void detector.detectField();
  else void detector.scheduleFromText(sourceEl.value);

  // All defaults (tone, model, languages, working language, frequent
  // languages) are loaded pre-paint via the Promise.all at the top of
  // mountPopover — no post-paint reapply needed.
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// The pre-token "thinking" indicator: a label plus three pulsing dots.
const buildThinkingIndicator = (): HTMLElement => {
  const wrap = document.createElement("span");
  wrap.className = "thinking";
  const label = document.createElement("span");
  label.textContent = "Thinking";
  const dots = document.createElement("span");
  dots.className = "thinking-dots";
  dots.append(
    document.createElement("i"),
    document.createElement("i"),
    document.createElement("i"),
  );
  wrap.append(label, dots);
  return wrap;
};

const createActionButton = (action: Action): HTMLButtonElement => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "action";
  btn.setAttribute("role", "tab");
  btn.setAttribute("aria-selected", "false");
  btn.dataset["action"] = action;
  const icon = document.createElement("span");
  icon.innerHTML = ACTION_ICONS[action];
  const label = document.createElement("span");
  label.textContent = ACTION_LABELS[action];
  btn.append(icon.firstElementChild as Node, label);
  return btn;
};

const createButton = (label: string, variantClass: string, iconSvg: string): HTMLButtonElement => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `btn ${variantClass}`;
  setButtonLabel(btn, label, iconSvg);
  return btn;
};

const setButtonLabel = (btn: HTMLButtonElement, label: string, iconSvg: string): void => {
  btn.replaceChildren();
  const text = document.createElement("span");
  text.textContent = label;
  btn.append(text);
  const wrapper = document.createElement("span");
  wrapper.innerHTML = iconSvg;
  const icon = wrapper.firstElementChild;
  if (icon) btn.append(icon);
  // Add a kbd hint for the primary "Generate" button.
  if (label === "Generate") {
    const kbd = document.createElement("span");
    kbd.className = "kbd";
    kbd.textContent = KBD_SHORTCUT_HINT;
    btn.append(kbd);
  }
};

const replaceFieldText = (el: HTMLElement, text: string): void => {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus();
    el.select();
    el.setRangeText(text, 0, el.value.length, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  if (el.isContentEditable) {
    el.focus();
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.addRange(range);
      try {
        document.execCommand("insertText", false, text);
        return;
      } catch {
        /* ignore */
      }
    }
    el.textContent = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
};
