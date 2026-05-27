// Fixed-position loader card shown while the right-click OCR pipeline
// runs in the background.
//
// Why this exists: the OCR pipeline (image extract → cloud vision call)
// takes 1–3 seconds, which is too long to leave the user staring at the
// page wondering whether their context-menu click registered. The
// content script puts this loader up the instant the menu fires, then
// the eventual OPEN_OCR_POPOVER message replaces it with the full
// popover carrying the recognised text.
//
// Vanilla DOM inside a closed Shadow Root — no React, no Tailwind — so
// the bundle stays small and the loader can't be styled / read by the
// host page. Visual language matches the popover (dark zinc card,
// indigo accent, drop-icon brand mark) so the swap to the popover feels
// like a continuation rather than a context shift.

const ROOT_ATTR = "data-inkwell-root";
const ROOT_KIND = "ocr-loader";

let activeHost: HTMLElement | null = null;
let dismissedByUser = false;

export interface ShowOcrLoaderOptions {
  /** Invoked when the user clicks the loader's Cancel button. */
  onCancel?: () => void;
}

export function showOcrLoader(opts: ShowOcrLoaderOptions = {}): void {
  // Tear down any previous loader before mounting a fresh one — the
  // background may fire a new context-menu click while a previous one
  // is still in flight.
  hideOcrLoader();
  dismissedByUser = false;

  if (!document.body) {
    // Page is too early to host the shadow root — try again on the
    // next frame so we don't lose the dispatch on slow loads.
    requestAnimationFrame(() => showOcrLoader(opts));
    return;
  }

  const host = document.createElement("div");
  host.setAttribute(ROOT_ATTR, ROOT_KIND);
  // The host is a transparent overlay; clicks pass through to the page
  // unless they hit the loader card itself.
  host.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483647",
    "pointer-events:none",
  ].join(";");

  const shadow = host.attachShadow({ mode: "closed" });
  shadow.appendChild(buildStyle());
  shadow.appendChild(buildCard(opts));

  document.body.appendChild(host);
  activeHost = host;
}

/** Remove the loader card if it's currently mounted. Safe to call when
 *  nothing is mounted. */
export function hideOcrLoader(): void {
  if (!activeHost) return;
  const host = activeHost;
  activeHost = null;
  // Fade out, then detach. ~140 ms matches the trigger's existing
  // fade-out timing so concurrent UI feels coherent.
  const card = host.shadowRoot?.querySelector<HTMLElement>(".card");
  if (card) {
    card.classList.add("leaving");
    setTimeout(() => host.remove(), 140);
  } else {
    host.remove();
  }
}

/** Was the most recent loader dismissed by the user clicking Cancel?
 *  The content script checks this when the eventual popover message
 *  arrives so a cancelled OCR doesn't surprise the user with a popover
 *  they explicitly dismissed. */
export function wasOcrLoaderDismissed(): boolean {
  return dismissedByUser;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function buildStyle(): HTMLStyleElement {
  const s = document.createElement("style");
  s.textContent = `
    :host { all: initial; }
    .card {
      position: fixed;
      top: 24px;
      left: 50%;
      transform: translateX(-50%);
      pointer-events: auto;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      max-width: min(420px, calc(100vw - 32px));
      padding: 10px 12px 10px 14px;
      background: rgba(24, 24, 27, 0.96);
      color: #fafafa;
      border: 1px solid rgba(63, 63, 70, 0.85);
      border-radius: 14px;
      box-shadow:
        0 10px 30px rgba(0, 0, 0, 0.35),
        0 2px 6px rgba(0, 0, 0, 0.2),
        inset 0 1px 0 rgba(255, 255, 255, 0.04);
      font: 500 13px/1.3 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      animation: ink-in 160ms cubic-bezier(.2,.7,.3,1) both;
    }
    .card.leaving {
      animation: ink-out 140ms ease-in both;
    }
    @keyframes ink-in {
      from { opacity: 0; transform: translateX(-50%) translateY(-6px); }
      to   { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
    @keyframes ink-out {
      from { opacity: 1; transform: translateX(-50%) translateY(0); }
      to   { opacity: 0; transform: translateX(-50%) translateY(-4px); }
    }
    .brand {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 8px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: #fff;
      flex-shrink: 0;
    }
    .brand svg { width: 12px; height: 12px; }
    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid rgba(167, 139, 250, 0.3);
      border-top-color: #a78bfa;
      border-radius: 50%;
      animation: ink-spin 700ms linear infinite;
      flex-shrink: 0;
    }
    @keyframes ink-spin { to { transform: rotate(360deg); } }
    .text {
      flex: 1 1 auto;
      min-width: 0;
    }
    .title { font-weight: 600; color: #fafafa; }
    .subtitle {
      font-weight: 400;
      font-size: 11.5px;
      color: #a1a1aa;
      margin-top: 1px;
    }
    .cancel {
      appearance: none;
      background: transparent;
      border: 1px solid rgba(82, 82, 91, 0.6);
      color: #d4d4d8;
      cursor: pointer;
      padding: 4px 10px;
      border-radius: 8px;
      font: 600 11px system-ui, -apple-system, sans-serif;
      transition: background 100ms, border-color 100ms, color 100ms;
      flex-shrink: 0;
    }
    .cancel:hover {
      background: rgba(63, 63, 70, 0.6);
      border-color: rgba(113, 113, 122, 0.8);
      color: #fafafa;
    }
    .cancel:focus-visible {
      outline: 2px solid #a78bfa;
      outline-offset: 2px;
    }
    @media (prefers-reduced-motion: reduce) {
      .card, .card.leaving { animation-duration: 1ms; }
      .spinner { animation-duration: 1200ms; }
    }
  `;
  return s;
}

// Inlined drop-icon brand mark — same shape as the trigger button.
const ICON_DROP = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <path d="M12 4.88C13.13 6.94 16.13 9 16.13 11.44A5.25 5.25 0 1 1 7.88 11.44C7.88 9 10.88 6.94 12 4.88Z"/>
</svg>`;

function buildCard(opts: ShowOcrLoaderOptions): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";
  card.setAttribute("role", "status");
  card.setAttribute("aria-live", "polite");
  card.innerHTML = `
    <span class="brand">${ICON_DROP}</span>
    <span class="spinner" aria-hidden="true"></span>
    <div class="text">
      <div class="title">Extracting text from image</div>
      <div class="subtitle">Inkwell is running OCR — this usually takes a couple of seconds.</div>
    </div>
    <button class="cancel" type="button" aria-label="Cancel OCR">Cancel</button>
  `;
  const btn = card.querySelector<HTMLButtonElement>("button.cancel");
  btn?.addEventListener("click", () => {
    dismissedByUser = true;
    hideOcrLoader();
    opts.onCancel?.();
  });
  return card;
}
