// Floating Inkwell trigger that appears next to an editable field OR a text
// selection. Clicking it opens the popover for that source.
//
//   • Field mode  — the trigger tracks the field on scroll/resize, hides
//     while the user types fast, and dismisses when the field blurs.
//   • Selection mode — the trigger sits by the highlighted text and is
//     ephemeral: it dismisses on scroll or when the selection clears.
//
// The Inkwell ink-drop mark on the branded gradient, hover tooltip with the
// keyboard shortcut, smooth fade/scale. Mounted in the SAME closed Shadow
// DOM the popover uses.

import { mountPopover, type PopoverSource } from "./popover";
import type { SiteAdapter } from "./adapters";

const ROOT_ATTR = "data-inkwell-root";
const HIDE_WHILE_TYPING_MS = 350;
const REPOSITION_DEBOUNCE_MS = 16;

const KBD_SHORTCUT = navigator.platform.includes("Mac") ? "⌘⇧K" : "Ctrl+Shift+K";

let activeRoot: HTMLElement | null = null;
let cleanup: (() => void) | null = null;
// Tracks whether the popover is currently open. Module-level so the
// content script can ask "should I leave the trigger alone?" from
// outside callbacks (e.g. selection-cleared handler in index.ts) —
// otherwise an ephemeral page-selection change while the user is
// interacting with the popover would rip its shadow host out.
let popoverActive = false;

/** True while the popover is mounted. Read from content/index.ts to
 *  avoid dismissing the trigger (and the popover with it) when the
 *  user clicks inside the popover and that click incidentally
 *  collapses the page selection. */
export const isPopoverActive = (): boolean => popoverActive;

// The Inkwell brand mark — a filled ink drop. Matches icons/logo.svg.
const SVG_DROP = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
  <path d="M12 4.88C13.13 6.94 16.13 9 16.13 11.44A5.25 5.25 0 1 1 7.88 11.44C7.88 9 10.88 6.94 12 4.88Z"/>
</svg>`;

const triggerStyles = `
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; }

  @keyframes inkwell-trigger-in {
    from { opacity: 0; transform: scale(0.6); }
    to   { opacity: 1; transform: scale(1); }
  }
  @keyframes inkwell-trigger-out {
    from { opacity: 1; transform: scale(1); }
    to   { opacity: 0; transform: scale(0.6); }
  }
  @keyframes inkwell-tooltip-in {
    from { opacity: 0; transform: translateY(2px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .trigger {
    pointer-events: auto;
    position: fixed;
    width: 28px; height: 28px;
    display: inline-flex; align-items: center; justify-content: center;
    border: 0; border-radius: 9999px;
    background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
    color: #ffffff;
    cursor: pointer;
    box-shadow:
      0 1px 2px rgba(0,0,0,0.15),
      0 4px 14px rgba(99,102,241,0.35);
    animation: inkwell-trigger-in 160ms cubic-bezier(.2,.8,.2,1) both;
    transition: transform 100ms ease, box-shadow 120ms ease;
    user-select: none;
    z-index: 2147483646;
  }
  .trigger:hover {
    transform: scale(1.06);
    box-shadow:
      0 1px 2px rgba(0,0,0,0.15),
      0 6px 20px rgba(99,102,241,0.45);
  }
  .trigger:active { transform: scale(0.96); }
  .trigger:focus-visible {
    outline: 2px solid #818cf8;
    outline-offset: 3px;
  }
  .trigger svg { width: 14px; height: 14px; }

  .trigger.fading-out { animation: inkwell-trigger-out 120ms ease both; }

  .tooltip {
    pointer-events: none;
    position: fixed;
    background: #18181b;
    color: #f4f4f5;
    font: 500 11px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
      Roboto, "Helvetica Neue", Arial, sans-serif;
    padding: 6px 8px; border-radius: 6px;
    white-space: nowrap;
    box-shadow: 0 4px 12px rgba(0,0,0,0.18);
    -webkit-font-smoothing: antialiased;
    animation: inkwell-tooltip-in 120ms ease both;
    z-index: 2147483647;
  }
  .tooltip .kbd {
    display: inline-block; margin-left: 6px;
    padding: 2px 5px; border-radius: 4px;
    background: rgba(255,255,255,0.12);
    font: 500 10px/1 ui-monospace, "SF Mono", Menlo, monospace;
    color: #e4e4e7;
  }

  @media (prefers-reduced-motion: reduce) {
    .trigger, .trigger.fading-out, .tooltip { animation: none; }
  }
`;

const buildRoot = (): { host: HTMLElement; shadow: ShadowRoot } => {
  const host = document.createElement("div");
  host.setAttribute(ROOT_ATTR, "");
  // Keep host invisible to layout; children pin themselves to viewport.
  host.style.cssText = [
    "all:initial",
    "position:absolute",
    "top:0",
    "left:0",
    "width:0",
    "height:0",
    "pointer-events:none",
    "z-index:2147483646",
  ].join(";");
  const shadow = host.attachShadow({ mode: "closed" });
  document.documentElement.appendChild(host);
  return { host, shadow };
};

const positionTrigger = (btn: HTMLElement, rect: DOMRect): void => {
  // Just inside the bottom-right corner of the anchor, slightly overlapping.
  const top = Math.max(4, rect.bottom - 26);
  const left = Math.max(4, Math.min(window.innerWidth - 32, rect.right - 26));
  btn.style.top = `${top}px`;
  btn.style.left = `${left}px`;
};

const positionTooltip = (tip: HTMLElement, trigger: HTMLElement): void => {
  const rect = trigger.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  const above = rect.top - tipRect.height - 8;
  const below = rect.bottom + 8;
  const top = above > 8 ? above : below;
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  left = Math.max(8, Math.min(window.innerWidth - tipRect.width - 8, left));
  tip.style.top = `${top}px`;
  tip.style.left = `${left}px`;
};

export const removeTrigger = (immediate = false): void => {
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
  // Clear the module-level "popover active" flag — defensive, in case
  // the trigger is removed externally (e.g., a new mount via
  // `mountTrigger` calls us with `immediate=true`) while a popover
  // was up. Keeping a stale `true` would block future selection-clear
  // dismissals.
  popoverActive = false;
  if (!activeRoot) return;
  const root = activeRoot;
  activeRoot = null;
  if (immediate) {
    root.remove();
    return;
  }
  const inner = root.shadowRoot?.querySelector<HTMLElement>(".trigger");
  if (!inner) {
    root.remove();
    return;
  }
  inner.classList.add("fading-out");
  setTimeout(() => root.remove(), 130);
};

export interface TriggerOptions {
  /** What the popover will work on. */
  source: PopoverSource;
  /** Site adapter — used for the `site` id and field-mode extraction. */
  adapter: SiteAdapter;
  /** Returns the viewport rect the Inkwell button and popover anchor against. */
  rect: () => DOMRect;
  /**
   * field mode → an element to track; the trigger follows it on
   * scroll/resize and dismisses on blur. selection/blank → null; the
   * trigger is ephemeral and dismisses on scroll.
   */
  follow: HTMLElement | null;
  openImmediately?: boolean;
}

export const mountTrigger = (opts: TriggerOptions): void => {
  removeTrigger(true);

  const { source, adapter, rect, follow } = opts;
  const { host, shadow } = buildRoot();
  activeRoot = host;

  // Once the popover is open it owns its own dismissal (Esc / outside-click).
  // The trigger's ephemeral handlers — scroll-to-dismiss, blur-to-dismiss —
  // must then stand down: they would otherwise tear down the shared shadow
  // host out from under an open popover, destroying it mid-use.
  let popoverOpen = false;

  const styleEl = document.createElement("style");
  styleEl.textContent = triggerStyles;
  shadow.appendChild(styleEl);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "trigger";
  btn.setAttribute("aria-label", `Inkwell — ${KBD_SHORTCUT}`);
  btn.innerHTML = SVG_DROP;
  shadow.appendChild(btn);
  positionTrigger(btn, rect());

  // Tooltip on hover/focus.
  let tooltip: HTMLElement | null = null;
  const showTooltip = (): void => {
    if (tooltip) return;
    tooltip = document.createElement("div");
    tooltip.className = "tooltip";
    const verb = source.kind === "selection" ? "Improve selection" : "Inkwell";
    tooltip.innerHTML = `${verb}<span class="kbd">${KBD_SHORTCUT}</span>`;
    shadow.appendChild(tooltip);
    requestAnimationFrame(() => tooltip && positionTooltip(tooltip, btn));
  };
  const hideTooltip = (): void => {
    tooltip?.remove();
    tooltip = null;
  };
  btn.addEventListener("mouseenter", showTooltip);
  btn.addEventListener("mouseleave", hideTooltip);
  btn.addEventListener("focus", showTooltip);
  btn.addEventListener("blur", hideTooltip);

  let rafId = 0;
  const reposition = (): void => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      positionTrigger(btn, rect());
      if (tooltip) positionTooltip(tooltip, btn);
      rafId = 0;
    });
  };
  const repositionDebounced = (() => {
    let t = 0;
    return () => {
      window.clearTimeout(t);
      t = window.setTimeout(reposition, REPOSITION_DEBOUNCE_MS);
    };
  })();

  // Scroll/resize behaviour depends on the mode:
  //   • field     — the trigger follows its field on scroll/resize.
  //   • selection — ephemeral; the highlight scrolls away, so dismiss.
  //   • blank     — anchored to a fixed viewport point and the user may be
  //                 typing into it, so ignore scroll — an accidental scroll
  //                 must never discard their draft.
  const onScrollResize = follow
    ? repositionDebounced
    : source.kind === "selection"
      ? (): void => {
          if (!popoverOpen) removeTrigger();
        }
      : (): void => {};
  window.addEventListener("scroll", onScrollResize, true);
  window.addEventListener("resize", onScrollResize, true);

  // Field-only: hide while typing fast; dismiss on blur.
  let typingTimer = 0;
  const onFieldInput = (): void => {
    btn.style.opacity = "0";
    btn.style.pointerEvents = "none";
    hideTooltip();
    window.clearTimeout(typingTimer);
    typingTimer = window.setTimeout(() => {
      btn.style.opacity = "1";
      btn.style.pointerEvents = "";
      reposition();
    }, HIDE_WHILE_TYPING_MS);
  };
  const onFieldBlur = (): void => {
    setTimeout(() => {
      if (popoverOpen) return;
      const ae = document.activeElement;
      if (ae === follow) return;
      if (ae?.closest?.(`[${ROOT_ATTR}]`)) return;
      removeTrigger();
    }, 100);
  };
  if (follow) {
    follow.addEventListener("input", onFieldInput);
    follow.addEventListener("blur", onFieldBlur);
  }

  // Open the popover. The trigger hides; the popover takes over.
  const openPopover = (): void => {
    popoverOpen = true;
    popoverActive = true;
    btn.style.display = "none";
    void mountPopover({
      shadow,
      anchorRect: rect(),
      source,
      adapter,
      onClose: () => {
        // Restore the trigger so a second click re-opens the popover.
        popoverOpen = false;
        popoverActive = false;
        btn.style.display = "";
      },
    });
  };
  // Preserve the page's text selection. A mousedown on the Inkwell button would
  // otherwise move focus and collapse the highlight the user just made —
  // a flicker, even though selection mode already snapshots the text.
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", openPopover);

  cleanup = () => {
    window.removeEventListener("scroll", onScrollResize, true);
    window.removeEventListener("resize", onScrollResize, true);
    if (follow) {
      follow.removeEventListener("input", onFieldInput);
      follow.removeEventListener("blur", onFieldBlur);
    }
    if (rafId) cancelAnimationFrame(rafId);
    window.clearTimeout(typingTimer);
    hideTooltip();
  };

  if (opts.openImmediately) openPopover();
};
