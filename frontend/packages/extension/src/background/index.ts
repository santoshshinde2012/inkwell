// Background service worker. The ONLY component that makes network calls
// to our backend and consumes the SSE stream from /api/v1/complete.
//
// There is no authentication — no tokens, no auth flows, no external
// messaging. The worker routes a small set of internal messages via a
// handler registry; adding a message type means registering a handler.

import {
  CheckSiteAllowedMessageSchema,
  CheckSiteAllowedResponse,
  CompleteCancelMessageSchema,
  CompleteStartMessageSchema,
  ERROR_CODES,
  LIMITS,
  MESSAGE_TYPES,
  type MessageType,
  type OpenOcrLoaderMessage,
  type OpenOcrPopoverMessage,
  OpenSidePanelFromPopoverMessageSchema,
} from "@inkwell/shared";
import { cancelStream, handleCompleteStream, type ResponseTarget } from "./api-client";
import { evaluateSite } from "../lib/site-policy";
import { localStore } from "../lib/storage";
import { clearModelCatalogCache, refreshModelCatalog } from "../lib/models";
import { stashHandoff } from "../lib/ui-state";

// Make the toolbar action open the Side Panel rather than a popup. The
// manifest deliberately omits `default_popup` so this call wins — clicking
// the icon docks the persistent assistant on the right of the window.
// Wrapped in try/catch because chrome.sidePanel is only available on
// Chrome 114+; older browsers should still load the extension.
try {
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
} catch {
  /* sidePanel API unavailable — toolbar icon click is a no-op then */
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

// ID of the right-click "Extract text" entry on page images. Pulled out
// so the install + click handlers reference the same constant.
const OCR_MENU_ID = "inkwell-ocr-image";

// chrome.alarms name for the periodic model-catalog refresh. Six hours
// is a deliberate compromise: short enough that a model added on the
// backend appears the same workday, long enough that a busy user
// doesn't see repeated network traffic for an endpoint that rarely
// changes. The user can force-refresh by reloading the extension or by
// changing the backend URL (both wired below).
const MODEL_CATALOG_ALARM = "inkwell.refreshModelCatalog";
const MODEL_CATALOG_REFRESH_HOURS = 6;
const SETTINGS_BACKEND_URL_KEY = "settings.backendUrl";

/** Pull the current backend config out of storage and refresh the
 *  model catalog against it. Best-effort: failures are swallowed so a
 *  flaky network doesn't surface as an "uncaught (in promise)" log. */
const refreshModelsFromStorage = async (): Promise<void> => {
  try {
    const s = await localStore.getAll();
    await refreshModelCatalog(s.backendUrl, s.apiKey || undefined);
  } catch {
    /* non-fatal — UI surfaces fall back to the cached / bundled list */
  }
};

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install" && !__DEV__) {
    chrome.runtime.openOptionsPage().catch(() => {});
  }
  // Context menu entries are wiped on every extension reload, so we
  // re-create on every onInstalled fire (install + update). `create`
  // throws if the id already exists; the removeAll first keeps it idempotent.
  try {
    chrome.contextMenus?.removeAll(() => {
      try {
        chrome.contextMenus?.create({
          id: OCR_MENU_ID,
          title: "Extract text with Inkwell",
          contexts: ["image"],
        });
      } catch {
        /* contextMenus may be unavailable on very old Chromium builds */
      }
    });
  } catch {
    /* same */
  }

  // Seed the model catalog cache + schedule the periodic refresh.
  // Runs on install AND update so a re-built extension picks up any
  // new backend-side models on the very first request after reload.
  void refreshModelsFromStorage();
  try {
    chrome.alarms?.create(MODEL_CATALOG_ALARM, {
      periodInMinutes: MODEL_CATALOG_REFRESH_HOURS * 60,
    });
  } catch {
    /* alarms unavailable — startup refresh still covers most cases */
  }
});

// Browser-startup refresh — keeps the cache warm across browser
// restarts (the service worker also dies between sessions, so the
// alarm is the only thing that fires while Chrome is closed).
chrome.runtime.onStartup?.addListener(() => {
  void refreshModelsFromStorage();
});

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === MODEL_CATALOG_ALARM) {
    void refreshModelsFromStorage();
  }
});

// React to a backend URL change immediately: drop the stale cache so
// the next render falls back to the bundled list, then re-fetch from
// the new backend.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!(SETTINGS_BACKEND_URL_KEY in changes)) return;
  void (async () => {
    await clearModelCatalogCache();
    await refreshModelsFromStorage();
  })();
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open-popover") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "OPEN_POPOVER_AT_FOCUS" }).catch(() => {
    // Content script may not be loaded on chrome:// pages, etc.
  });
});

// ---------------------------------------------------------------------------
// Right-click "Extract text with Inkwell" on a page image
//
// Flow:
//   1. Extract the image pixels into a data URL. We use
//      chrome.scripting.executeScript so the fetch / canvas readback
//      runs in the page's origin (the page already loaded the image, so
//      cross-origin / CORS rules play out there instead of bouncing
//      against the extension's narrow host_permissions). Tainted
//      canvases fall back to chrome.tabs.captureVisibleTab + an
//      OffscreenCanvas crop, which works for opaque cross-origin CDN
//      images.
//   2. Call the backend's /api/v1/ocr in the background service worker
//      to recognise the text. The background has the extension's
//      origin, so backend CORS is happy.
//   3. Tell the active tab's content script to open the in-page
//      popover, pre-filled with the extracted text (or the error
//      message). The popover surface — not the side panel — is now the
//      home for right-click OCR results, per user preference.
//   4. If the content script isn't loaded on the active tab (file://
//      pages, chrome:// pages, sandboxed iframes), fall back to opening
//      the side panel with the result instead, so the user still sees
//      something useful rather than silent failure.
// ---------------------------------------------------------------------------

chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== OCR_MENU_ID) return;
  if (!info.srcUrl || tab?.id == null) return;
  const tabId = tab.id;

  // Fire the loader immediately so the user sees a card the instant
  // they pick the menu item — the OCR pipeline itself takes 1–3 s.
  // Best-effort: silently ignored on tabs without a content script
  // (we'll fall back to the side panel when the result is ready).
  void chrome.tabs
    .sendMessage(tabId, {
      type: MESSAGE_TYPES.OPEN_OCR_LOADER,
    } satisfies OpenOcrLoaderMessage)
    .catch(() => {
      /* no content script on this tab — fallback handles it later */
    });

  // Run the whole pipeline in a fire-and-forget — context menu clicks
  // expect immediate dismissal of the menu, not a blocked UI thread.
  void runContextMenuOcr(tab, info.frameId, info.srcUrl).then(
    async (outcome) => {
      const delivered = await deliverToPopover(tabId, outcome);
      if (delivered) return;
      // Content script wasn't there to receive the popover dispatch
      // (e.g. chrome:// or file:// page without file-URL access).
      // Fall back to the side panel so the result still surfaces.
      console.info(
        "[inkwell] OCR popover couldn't be delivered to the tab — opening side panel instead.",
      );
      await openSidePanelFallback(tabId, outcome);
    },
    (err: unknown) => {
      console.warn("[inkwell] context-menu OCR failed", err);
    },
  );
});

type OcrOutcome = { ok: true; text: string } | { ok: false; reason: string };

/** Extract the image, then recognise it via the backend. Returns a UX-
 *  ready outcome — never throws. */
async function runContextMenuOcr(
  tab: chrome.tabs.Tab,
  frameId: number | undefined,
  srcUrl: string,
): Promise<OcrOutcome> {
  const fetchOut = await extractImageDataUrl(tab, frameId, srcUrl);
  if (!fetchOut.ok) return { ok: false, reason: fetchOut.reason };

  try {
    const settings = await localStore.getAll();
    const text = await recognizeViaBackend(
      settings.backendUrl,
      settings.apiKey || undefined,
      fetchOut.dataUrl,
    );
    if (!text) {
      return {
        ok: false,
        reason: "No readable text was found in that image.",
      };
    }
    return { ok: true, text };
  } catch (err) {
    return {
      ok: false,
      reason:
        err instanceof Error && err.message
          ? `Couldn't run OCR: ${err.message}`
          : "Couldn't reach the OCR backend. Check Settings → Backend.",
    };
  }
}

/** POST the image to /api/v1/ocr and return the recognised text. */
async function recognizeViaBackend(
  backendUrl: string,
  apiKey: string | undefined,
  imageDataUrl: string,
): Promise<string> {
  const { mimeType, base64 } = splitDataUrl(imageDataUrl);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const resp = await fetch(`${backendUrl}/api/v1/ocr`, {
    method: "POST",
    headers,
    body: JSON.stringify({ imageBase64: base64, mimeType }),
  });
  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`;
    try {
      const body = (await resp.json()) as { error?: { message?: string } };
      if (body?.error?.message) detail = body.error.message;
    } catch {
      /* non-JSON body — keep the HTTP detail */
    }
    throw new Error(detail);
  }
  const body = (await resp.json()) as { text?: string };
  return (body?.text ?? "").trim();
}

/** Pull mime + base64 out of a data: URL. Tolerates an empty body. */
function splitDataUrl(url: string): { mimeType: string; base64: string } {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/.exec(url);
  if (!m) return { mimeType: "image/png", base64: "" };
  const mime = m[1] || "image/png";
  const isB64 = !!m[2];
  const body = m[3] ?? "";
  if (isB64) return { mimeType: mime, base64: body };
  // Non-base64 data URLs are rare for images — encode the URI-decoded
  // body so the backend always sees standard base64.
  try {
    return { mimeType: mime, base64: btoa(unescape(decodeURIComponent(body))) };
  } catch {
    return { mimeType: mime, base64: "" };
  }
}

/** Try to dispatch the popover-open message to the active tab's
 *  content script. Returns false when no content script is listening on
 *  that tab (chrome://, file:// without file-access, etc.). The thrown
 *  error is logged so the operator can distinguish "missing listener"
 *  from genuine breakage. */
async function deliverToPopover(tabId: number, outcome: OcrOutcome): Promise<boolean> {
  const payload: OpenOcrPopoverMessage = {
    type: MESSAGE_TYPES.OPEN_OCR_POPOVER,
    ...(outcome.ok ? { text: outcome.text } : { errorMessage: outcome.reason }),
  };
  try {
    await chrome.tabs.sendMessage(tabId, payload);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.info(`[inkwell] tabs.sendMessage(OPEN_OCR_POPOVER) on tab ${tabId} failed: ${msg}`);
    return false;
  }
}

/** Fallback when the content script can't receive the popover dispatch
 *  — we open the side panel and stash the result the way the legacy
 *  handoff already supports. */
async function openSidePanelFallback(tabId: number, outcome: OcrOutcome): Promise<void> {
  try {
    await chrome.sidePanel?.open({ tabId });
  } catch {
    return; // side panel API unavailable — nothing we can do
  }
  await stashHandoff(outcome.ok ? { text: outcome.text } : { errorMessage: outcome.reason });
}

type ImageFetchOutcome = { ok: true; dataUrl: string } | { ok: false; reason: string };

/**
 * Get a data URL of a right-clicked image, trying three strategies in
 * order of fidelity:
 *
 *   1. Canvas readback in the source page. Works for same-origin and
 *      CORS-allowed images. Returns the image at its natural resolution.
 *   2. Visible-tab screenshot cropped to the image's bounding rect.
 *      Works for opaque cross-origin images (the common CDN case).
 *      Quality is capped by what's rendered on-screen, but for OCR
 *      that's nearly always good enough.
 *   3. Give up with a user-facing reason.
 *
 * Steps 1 and 2 share an executeScript trip: the in-page func attempts
 * canvas readback AND collects the rect either way, so step 2 has what
 * it needs without a second round trip.
 */
async function extractImageDataUrl(
  tab: chrome.tabs.Tab,
  frameId: number | undefined,
  srcUrl: string,
): Promise<ImageFetchOutcome> {
  const tabId = tab.id;
  if (tabId == null) {
    return { ok: false, reason: "Couldn't reach the page to read that image." };
  }

  type PageProbe =
    | { kind: "data"; dataUrl: string }
    | { kind: "rect"; rect: { x: number; y: number; w: number; h: number }; dpr: number }
    | { kind: "missing" };

  let probe: PageProbe;
  try {
    const [res] = await chrome.scripting.executeScript({
      target: {
        tabId,
        ...(frameId != null ? { frameIds: [frameId] } : {}),
      },
      // Self-contained: executeScript serialises and re-executes this in
      // the page, so we can't reference module-scope identifiers.
      func: async (url: string, maxBytes: number): Promise<PageProbe> => {
        const pickImg = (): HTMLImageElement | null => {
          const imgs = Array.from(document.querySelectorAll("img"));
          // Prefer currentSrc (the resolved srcset entry) over src.
          const exact = imgs.find((i) => i.currentSrc === url || i.src === url);
          if (exact) return exact;
          // Fallback: any img whose URL ends with the same path — handy
          // when the page uses signed URLs that drift between renders.
          try {
            const path = new URL(url).pathname;
            return (
              imgs.find((i) => {
                try {
                  return new URL(i.currentSrc || i.src).pathname === path;
                } catch {
                  return false;
                }
              }) ?? null
            );
          } catch {
            return null;
          }
        };

        const img = pickImg();
        if (!img) return { kind: "missing" };

        // Wait for the image to be ready before we read pixels.
        if (!img.complete || img.naturalWidth === 0) {
          await new Promise<void>((resolve) => {
            const onLoad = (): void => {
              cleanup();
              resolve();
            };
            const cleanup = (): void => {
              img.removeEventListener("load", onLoad);
              img.removeEventListener("error", onLoad);
            };
            img.addEventListener("load", onLoad);
            img.addEventListener("error", onLoad);
            // Don't wait forever; fall through to rect-only after 3s.
            setTimeout(() => {
              cleanup();
              resolve();
            }, 3000);
          });
        }

        const rect = img.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const rectOut = {
          x: rect.left,
          y: rect.top,
          w: rect.width,
          h: rect.height,
        };

        // Try canvas readback at the image's natural resolution. Tainted
        // canvases throw on toDataURL, which is our cue to fall back to
        // a visible-tab screenshot crop.
        try {
          const w = img.naturalWidth || Math.round(rect.width);
          const h = img.naturalHeight || Math.round(rect.height);
          if (w > 0 && h > 0) {
            const c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            const ctx = c.getContext("2d");
            if (ctx) {
              ctx.drawImage(img, 0, 0, w, h);
              // Pick a format/quality that keeps payloads small. JPEG
              // at 0.92 quality is plenty for OCR and ~5x smaller than
              // PNG for typical UI screenshots.
              const dataUrl = c.toDataURL("image/jpeg", 0.92);
              // Estimate decoded size — data URL is base64, ~4/3 of raw.
              const estBytes = Math.floor(((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4);
              if (estBytes <= maxBytes) {
                return { kind: "data", dataUrl };
              }
              // Too large — fall through to the rect crop, which works
              // on the on-screen render (smaller pixel count).
            }
          }
        } catch {
          /* tainted canvas — fall through */
        }

        return { kind: "rect", rect: rectOut, dpr };
      },
      args: [srcUrl, LIMITS.MAX_OCR_IMAGE_BYTES],
    });
    probe = res?.result ?? { kind: "missing" };
  } catch (err) {
    return {
      ok: false,
      reason:
        err instanceof Error && err.message
          ? `Couldn't read the image: ${err.message}`
          : "Couldn't reach the page to read that image.",
    };
  }

  if (probe.kind === "data") {
    return { ok: true, dataUrl: probe.dataUrl };
  }
  if (probe.kind === "missing") {
    return {
      ok: false,
      reason: "Couldn't locate that image on the page anymore.",
    };
  }

  // Cross-origin / tainted canvas case: fall back to capturing the
  // visible tab and cropping to the image's rect. This works for the
  // overwhelming majority of CDN-served images.
  return captureAndCrop(tab, probe.rect, probe.dpr);
}

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

async function captureAndCrop(
  tab: chrome.tabs.Tab,
  rect: CropRect,
  dpr: number,
): Promise<ImageFetchOutcome> {
  if (tab.windowId == null) {
    return { ok: false, reason: "Couldn't find the tab's window to capture." };
  }
  if (rect.w < 4 || rect.h < 4) {
    return {
      ok: false,
      reason:
        "That image is too small to OCR — open it at full size first, then right-click again.",
    };
  }

  let snapshotDataUrl: string;
  try {
    snapshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "png",
    });
  } catch (err) {
    return {
      ok: false,
      reason:
        err instanceof Error && err.message
          ? `Couldn't capture the tab: ${err.message}`
          : "Couldn't capture the visible tab for OCR.",
    };
  }
  if (!snapshotDataUrl) {
    return { ok: false, reason: "The tab capture came back empty." };
  }

  try {
    const blob = await (await fetch(snapshotDataUrl)).blob();
    const bitmap = await createImageBitmap(blob);

    // captureVisibleTab returns at device-pixel resolution; the rect is
    // in CSS pixels. Scale up before cropping.
    const sx = Math.max(0, Math.round(rect.x * dpr));
    const sy = Math.max(0, Math.round(rect.y * dpr));
    const sw = Math.min(bitmap.width - sx, Math.round(rect.w * dpr));
    const sh = Math.min(bitmap.height - sy, Math.round(rect.h * dpr));
    if (sw <= 0 || sh <= 0) {
      return {
        ok: false,
        reason: "That image is off-screen — scroll it into view and right-click again.",
      };
    }

    const canvas = new OffscreenCanvas(sw, sh);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return { ok: false, reason: "Couldn't open an OCR canvas." };
    }
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
    const croppedBlob = await canvas.convertToBlob({
      type: "image/png",
    });
    bitmap.close();

    if (croppedBlob.size > LIMITS.MAX_OCR_IMAGE_BYTES) {
      return {
        ok: false,
        reason: "Captured image is too large — try zooming out or use a smaller view of the image.",
      };
    }

    const dataUrl = await blobToDataUrl(croppedBlob);
    return { ok: true, dataUrl };
  } catch (err) {
    return {
      ok: false,
      reason:
        err instanceof Error && err.message
          ? `Couldn't process the capture: ${err.message}`
          : "Couldn't process the visible-tab capture.",
    };
  }
}

// Service workers don't expose FileReader, so we base64-encode by hand.
// Chunked to dodge the call-stack limit on String.fromCharCode for big
// arrays.
async function blobToDataUrl(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

// ---------------------------------------------------------------------------
// Handler registry
// ---------------------------------------------------------------------------

type HandlerResult = unknown | Promise<unknown>;
type Handler = (msg: unknown, sender: chrome.runtime.MessageSender) => HandlerResult;

const handleCompleteStart: Handler = (rawMsg, sender) => {
  const parsed = CompleteStartMessageSchema.safeParse(rawMsg);
  if (!parsed.success) return { ok: false, error: parsed.error.flatten() };
  // Two callers can start a stream:
  //   - the in-page popover (a content script): we route tokens back to its
  //     tab via chrome.tabs.sendMessage;
  //   - the side panel (an extension page with no tab): tokens go via
  //     chrome.runtime.sendMessage and the page filters on streamId.
  const target: ResponseTarget =
    sender.tab?.id != null ? { kind: "tab", tabId: sender.tab.id } : { kind: "runtime" };
  // Streaming response: ack immediately; tokens flow back asynchronously.
  void handleCompleteStream({
    message: parsed.data,
    target,
  });
  return { ok: true };
};

const handleCompleteCancel: Handler = (rawMsg) => {
  const parsed = CompleteCancelMessageSchema.safeParse(rawMsg);
  if (!parsed.success) return { ok: false };
  cancelStream(parsed.data.streamId);
  return { ok: true };
};

const handleCheckSiteAllowed: Handler = async (rawMsg) => {
  const parsed = CheckSiteAllowedMessageSchema.safeParse(rawMsg);
  if (!parsed.success) {
    return {
      allowed: false,
      reason: "blocked-by-default",
    } satisfies CheckSiteAllowedResponse;
  }
  const verdict = await evaluateSite(parsed.data.hostname);
  return {
    allowed: verdict.allowed,
    reason: verdict.reason,
  } satisfies CheckSiteAllowedResponse;
};

/**
 * Hand-off from the in-page popover to the Chrome Side Panel.
 *
 * Two things matter here:
 *
 *   1. `chrome.sidePanel.open` must be called synchronously from this
 *      handler — `chrome.runtime.sendMessage` preserves the popover
 *      button's user gesture across the dispatch, but only if we open
 *      the panel before any `await`. The stash write fires after, so
 *      it can't dilute the gesture context.
 *   2. The stash write is best-effort. If it fails, the side panel just
 *      opens empty rather than crashing.
 */
const handleOpenSidePanel: Handler = (rawMsg, sender) => {
  const parsed = OpenSidePanelFromPopoverMessageSchema.safeParse(rawMsg);
  if (!parsed.success) return { ok: false, error: parsed.error.flatten() };
  const tabId = sender.tab?.id;
  if (tabId == null) {
    return { ok: false, error: { message: "Missing tab id" } };
  }
  try {
    void chrome.sidePanel?.open({ tabId }).catch((err) => {
      console.warn("[inkwell] sidePanel.open failed", err);
    });
  } catch (err) {
    return {
      ok: false,
      error: {
        message: err instanceof Error ? err.message : "sidePanel API unavailable",
      },
    };
  }
  // Fire-and-forget the stash; it doesn't affect the gesture-bound
  // open() above. Spread the optional fields conditionally so the
  // stashed record never carries explicit `undefined` values —
  // matters under exactOptionalPropertyTypes.
  if (parsed.data.text || parsed.data.action) {
    void stashHandoff({
      ...(parsed.data.text ? { text: parsed.data.text } : {}),
      ...(parsed.data.action ? { action: parsed.data.action } : {}),
    });
  }
  return { ok: true };
};

const HANDLERS: Partial<Record<MessageType, Handler>> = {
  [MESSAGE_TYPES.COMPLETE_START]: handleCompleteStart,
  [MESSAGE_TYPES.COMPLETE_CANCEL]: handleCompleteCancel,
  [MESSAGE_TYPES.CHECK_SITE_ALLOWED]: handleCheckSiteAllowed,
  [MESSAGE_TYPES.OPEN_SIDE_PANEL_FROM_POPOVER]: handleOpenSidePanel,
};

// ---------------------------------------------------------------------------
// Internal message router
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((rawMsg, sender, sendResponse) => {
  // Only accept messages from our own extension.
  if (sender.id !== chrome.runtime.id) {
    sendResponse({
      ok: false,
      error: { code: ERROR_CODES.FORBIDDEN, message: "Bad sender" },
    });
    return false;
  }

  if (!rawMsg || typeof rawMsg !== "object" || !("type" in rawMsg)) {
    sendResponse({
      ok: false,
      error: { code: ERROR_CODES.VALIDATION_FAILED, message: "Bad message" },
    });
    return false;
  }

  const handler = HANDLERS[(rawMsg as { type: MessageType }).type];
  if (!handler) {
    sendResponse({
      ok: false,
      error: { code: ERROR_CODES.VALIDATION_FAILED, message: "Unknown type" },
    });
    return false;
  }

  const result = handler(rawMsg, sender);

  // Async result: keep the messaging channel open until sendResponse.
  if (result instanceof Promise) {
    result
      .then((value) => sendResponse(value))
      .catch((err: unknown) =>
        sendResponse({
          ok: false,
          error: {
            code: ERROR_CODES.INTERNAL_ERROR,
            message: err instanceof Error ? err.message : "handler error",
          },
        }),
      );
    return true;
  }

  sendResponse(result);
  return false;
});
