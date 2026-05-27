// Content script. Runs on every page (per the manifest match) but does
// nothing until the site policy says we're allowed. Once allowed, the
// extension can be activated four ways:
//
//   1. Field      — the user focuses an editable field. The Inkwell
//                   trigger tracks the field; the result can be inserted
//                   or copied.
//   2. Selection  — the user highlights ANY text on the page (read-only
//                   or not). The Inkwell trigger appears by the highlight;
//                   the result is copy-only (we never write to the page).
//   3. Blank      — the keyboard shortcut with nothing focused/selected
//                   opens the popover with an empty box for the user to
//                   type or paste text into, then fix/rephrase it.
//   4. Image OCR  — the background dispatches OPEN_OCR_POPOVER after the
//                   right-click "Extract text with Inkwell" context menu.
//                   The popover opens centred in the viewport with the
//                   recognised text pre-filled as a selection.
//
// All UI lives inside a Shadow DOM so the host page can't restyle or read
// our nodes via the page's CSS/JS. The host page can still observe the
// shadow host element's location and size in the DOM tree, which is
// unavoidable without iframes.

import { MESSAGE_TYPES } from "@inkwell/shared";
import { sendToBackground } from "../lib/messaging";
import { hideOcrLoader, showOcrLoader, wasOcrLoaderDismissed } from "./ocr-loader";
import { isPopoverActive, mountTrigger, removeTrigger } from "./trigger";
import { selectAdapter, type SiteAdapter } from "./adapters";
import { isEditable } from "./editable";

const FOCUS_DEBOUNCE_MS = 50;
// Selecting text fires a burst of events (drag, shift+arrow); wait for it
// to settle before reacting so the trigger doesn't flicker mid-drag.
const SELECTION_DEBOUNCE_MS = 200;
const ROOT_ATTR = "data-inkwell-root";

/** Nearest element host for a (possibly text) node. */
const elementOf = (node: Node | null): HTMLElement | null => {
  if (!node) return null;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return el instanceof HTMLElement ? el : null;
};

/**
 * The current page selection, if it's something we should offer to work on:
 * non-empty, outside our own Shadow-DOM UI, and with a paintable rect.
 *
 * Selections inside a contenteditable used to be filtered out as
 * "field-mode territory," but rich-text editors (Medium, Substack,
 * Notion, LinkedIn's article composer) have *huge* contenteditable hosts.
 * The field trigger would anchor to the whole article body — far from
 * the user's actual highlight — making it functionally invisible. So we
 * mount the selection trigger anchored to the highlight rect instead,
 * and the parent restores the field trigger if the user clears the
 * selection while still focused in the editor (see `evaluateSelection`).
 */
const getViableSelection = (): { text: string; rect: DOMRect } | null => {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;

  const text = sel.toString().trim();
  if (text.length < 1) return null;

  const host = elementOf(sel.anchorNode);
  if (!host) return null;
  // Never react to selections inside our own popover.
  if (host.closest(`[${ROOT_ATTR}]`)) return null;

  const rect = sel.getRangeAt(0).getBoundingClientRect();
  if (rect.width < 1 && rect.height < 1) return null;
  return { text, rect };
};

const init = async (): Promise<void> => {
  // Ask the background whether this site is allowed (sources of truth: user
  // settings + default blocklist).
  const verdict = await sendToBackground<{ allowed: boolean }>({
    type: MESSAGE_TYPES.CHECK_SITE_ALLOWED,
    hostname: window.location.hostname,
  });
  if (!verdict?.allowed) return;

  const adapter: SiteAdapter = selectAdapter(window.location.hostname);

  // Which trigger is currently mounted — so focusin doesn't re-mount the
  // same field, and a cleared selection only dismisses a selection trigger.
  let attachedField: HTMLElement | null = null;
  let selectionActive = false;
  let lastSelectionText = "";
  let lastFocus = 0;

  const mountFieldTrigger = (element: HTMLElement, openImmediately = false): void => {
    attachedField = element;
    selectionActive = false;
    lastSelectionText = "";
    mountTrigger({
      source: { kind: "field", element },
      adapter,
      rect: () => element.getBoundingClientRect(),
      follow: element,
      openImmediately,
    });
  };

  const mountSelectionTrigger = (text: string, rect: DOMRect, openImmediately = false): void => {
    attachedField = null;
    selectionActive = true;
    lastSelectionText = text;
    mountTrigger({
      source: { kind: "selection", text },
      adapter,
      // Selection rects don't move under us — the trigger is ephemeral and
      // dismisses on scroll — so a snapshot is fine.
      rect: () => rect,
      follow: null,
      openImmediately,
    });
  };

  const mountBlankTrigger = (): void => {
    attachedField = null;
    selectionActive = false;
    lastSelectionText = "";
    const rect = new DOMRect((window.innerWidth - 28) / 2, 96, 28, 28);
    mountTrigger({
      source: { kind: "blank" },
      adapter,
      rect: () => rect,
      follow: null,
      openImmediately: true,
    });
  };

  // --- Field mode: focus an editable field -------------------------------
  const onFocusIn = (event: FocusEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!isEditable(target)) return;

    // Debounce rapid focus chains (autofill, frameworks).
    const now = Date.now();
    if (now - lastFocus < FOCUS_DEBOUNCE_MS) return;
    lastFocus = now;

    if (attachedField === target) return;
    mountFieldTrigger(target);
  };
  document.addEventListener("focusin", onFocusIn, true);

  // --- Selection mode: highlight any text on the page --------------------
  // Field reference that was displaced when the user made a selection
  // inside an editable (Medium / Substack / Notion). Held here so we can
  // re-mount the field trigger when the selection clears but the field
  // is still focused. Distinct from `attachedField` because
  // `mountSelectionTrigger` clears the latter.
  let displacedField: HTMLElement | null = null;

  const evaluateSelection = (): void => {
    // When the popover is open the user has already committed to a
    // text snapshot; ignore page-selection changes that happen
    // *while* they interact with our UI. Without this guard, a click
    // on a popover button collapses the page selection as a browser
    // side-effect, this handler fires 200 ms later, and the shadow
    // host (popover and all) gets removed mid-Generate.
    if (isPopoverActive()) return;

    const sel = getViableSelection();
    if (!sel) {
      // Selection cleared. Only dismiss if it's a selection trigger showing;
      // a field trigger manages its own lifecycle (blur).
      if (selectionActive) {
        removeTrigger();
        selectionActive = false;
        lastSelectionText = "";
        // If we were displacing a contenteditable's field trigger, restore
        // it as long as the editor is still focused — otherwise the user
        // would lose any anchor on the field after a single click-away.
        if (displacedField && document.activeElement === displacedField) {
          mountFieldTrigger(displacedField);
        }
        displacedField = null;
      }
      return;
    }
    // Unchanged selection — leave the existing trigger (and any open
    // popover) alone.
    if (selectionActive && sel.text === lastSelectionText) return;
    // Stash the current field, if any, so we can put the field trigger
    // back when the selection clears. Only meaningful when the selection
    // lives inside that field (e.g. selecting a paragraph in a Medium
    // editor) — but harmless to remember in general.
    if (attachedField) displacedField = attachedField;
    mountSelectionTrigger(sel.text, sel.rect);
  };

  let selectionTimer = 0;
  const onSelectionEvent = (event: Event): void => {
    // Ignore selections/clicks inside our own Shadow-DOM UI.
    const t = event.target;
    if (t instanceof Element && t.closest(`[${ROOT_ATTR}]`)) return;
    window.clearTimeout(selectionTimer);
    selectionTimer = window.setTimeout(evaluateSelection, SELECTION_DEBOUNCE_MS);
  };
  document.addEventListener("mouseup", onSelectionEvent, true);
  document.addEventListener("keyup", onSelectionEvent, true);

  // --- Keyboard shortcut: pick the best mode for the current state -------
  const openAtFocus = (): void => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && isEditable(active)) {
      mountFieldTrigger(active, /* openImmediately */ true);
      return;
    }
    const sel = getViableSelection();
    if (sel) {
      mountSelectionTrigger(sel.text, sel.rect, /* openImmediately */ true);
      return;
    }
    // Nothing focused or selected — open a blank box to type into.
    mountBlankTrigger();
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const t = (msg as { type?: unknown } | null)?.type;
    if (t === "OPEN_POPOVER_AT_FOCUS") {
      openAtFocus();
      return false;
    }
    if (t === "GET_SELECTION") {
      // The side panel asks the active tab for its current selection on
      // demand. We reply synchronously with the raw selected text — never
      // anything from inside our own UI, which the side panel doesn't
      // need to know about.
      const sel = window.getSelection();
      const raw = sel ? sel.toString() : "";
      const anchor = sel?.anchorNode;
      const inOurUi =
        anchor instanceof Node &&
        (anchor.nodeType === Node.ELEMENT_NODE
          ? (anchor as Element)
          : anchor.parentElement
        )?.closest(`[${ROOT_ATTR}]`);
      sendResponse({ text: inOurUi ? "" : raw.trim() });
      return false;
    }
    return false;
  });
};

void init().catch((err: unknown) => {
  // Never throw from a content script — log and move on.
  console.warn("[inkwell] content init failed", err);
});

// ---------------------------------------------------------------------------
// OCR popover dispatch — registered at module level, OUTSIDE the site-
// policy gate that init() enforces.
//
// Why: right-click "Extract text with Inkwell" is an explicit user
// gesture. The site-policy block exists to keep the floating trigger
// off sensitive pages by default, not to suppress UI the user
// deliberately invoked. The handler also has to be registered
// synchronously at content-script load time (no awaits), so it's
// guaranteed to be in place before the background's tabs.sendMessage
// can race with init()'s async site-policy round-trip.
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg) => {
  const t = (msg as { type?: unknown } | null)?.type;
  if (t === MESSAGE_TYPES.OPEN_OCR_LOADER) {
    showOcrLoader();
    return false;
  }
  if (t === MESSAGE_TYPES.OPEN_OCR_POPOVER) {
    handleOcrResult(msg as { text?: string; errorMessage?: string });
    return false;
  }
  return false;
});

function handleOcrResult(msg: { text?: string; errorMessage?: string }): void {
  // If the user clicked Cancel on the loader, they explicitly opted
  // out — drop the result silently rather than surprising them with a
  // popover that pops up after they thought the action was over.
  const dismissed = wasOcrLoaderDismissed();
  hideOcrLoader();
  if (dismissed) return;
  openOcrPopover(msg);
}

function openOcrPopover(msg: { text?: string; errorMessage?: string }): void {
  const text = msg.text ?? msg.errorMessage ?? "";
  if (!text) return;
  if (!document.body) {
    // Extremely early load — defer one frame so mountTrigger has a
    // body to append the shadow host to. Shouldn't happen at
    // document_idle but defends against weird embeds.
    requestAnimationFrame(() => openOcrPopover(msg));
    return;
  }
  const adapter = selectAdapter(window.location.hostname);
  const W = 28;
  const H = 28;
  const rect = new DOMRect(
    Math.max(8, window.innerWidth / 2 - W / 2),
    Math.max(96, window.innerHeight / 2 - H / 2),
    W,
    H,
  );
  mountTrigger({
    source: { kind: "selection", text },
    adapter,
    rect: () => rect,
    follow: null,
    openImmediately: true,
  });
}
