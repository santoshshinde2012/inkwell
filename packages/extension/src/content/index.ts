// Content script. Runs on every page (per the manifest match) but does
// nothing until the site policy says we're allowed. Once allowed, the
// extension can be activated three ways:
//
//   1. Field    — the user focuses an editable field. The Inkwell trigger
//                 tracks the field; the result can be inserted or copied.
//   2. Selection — the user highlights ANY text on the page (read-only
//                 or not). The Inkwell trigger appears by the highlight; the
//                 result is copy-only (we never write to the page).
//   3. Blank    — the keyboard shortcut with nothing focused/selected
//                 opens the popover with an empty box for the user to
//                 type or paste text into, then fix/rephrase it.
//
// All UI lives inside a Shadow DOM so the host page can't restyle or read
// our nodes via the page's CSS/JS. The host page can still observe the
// shadow host element's location and size in the DOM tree, which is
// unavoidable without iframes.

import { MESSAGE_TYPES } from "@inkwell/shared";
import { sendToBackground } from "../lib/messaging";
import { mountTrigger, removeTrigger } from "./trigger";
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
  const el =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  return el instanceof HTMLElement ? el : null;
};

/**
 * The current page selection, if it's something we should offer to work on:
 * non-empty, outside any editable region (those belong to field mode), and
 * outside our own Shadow-DOM UI.
 */
const getViableSelection = (): { text: string; rect: DOMRect } | null => {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;

  const text = sel.toString().trim();
  if (text.length < 1) return null;

  const host = elementOf(sel.anchorNode);
  if (!host) return null;
  // A selection inside a contenteditable is field-mode territory.
  if (host.isContentEditable) return null;
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

  const mountFieldTrigger = (
    element: HTMLElement,
    openImmediately = false,
  ): void => {
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

  const mountSelectionTrigger = (
    text: string,
    rect: DOMRect,
    openImmediately = false,
  ): void => {
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
  const evaluateSelection = (): void => {
    const sel = getViableSelection();
    if (!sel) {
      // Selection cleared. Only dismiss if it's a selection trigger showing;
      // a field trigger manages its own lifecycle (blur).
      if (selectionActive) {
        removeTrigger();
        selectionActive = false;
        lastSelectionText = "";
      }
      return;
    }
    // Unchanged selection — leave the existing trigger (and any open
    // popover) alone.
    if (selectionActive && sel.text === lastSelectionText) return;
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
