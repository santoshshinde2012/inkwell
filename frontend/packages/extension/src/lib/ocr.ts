// OCR for the side panel.
//
// Posts the image to /api/v1/ocr, which calls a vision model
// (gpt-4o-mini by default). The backend is the only OCR engine in this
// build — there's no on-device fallback. The right-click context-menu
// path drives its own dedicated route in src/background/index.ts; this
// module covers the side panel's paste / drop / file-picker entry
// points, which all share the same `extractTextFromImage()` call.
//
// `firstImageFrom()` is plain DataTransfer plumbing with no engine
// dependency — kept here so the input bar can import it cheaply.

import {
  LIMITS,
  OCR_MIME_TYPES,
  type OcrMimeType,
  type OcrRequest,
  type OcrResponse,
} from "@inkwell/shared";

export interface OcrProgress {
  /** Short label describing the current phase ("Uploading image",
   *  "Recognising"). */
  status: string;
  /** 0..1 — progress within the current phase, or null when
   *  indeterminate. The backend path doesn't stream progress, so this
   *  is null today; the field is kept for forward compatibility. */
  progress: number | null;
}

type OcrSource = Blob | File;

interface OcrOptions {
  /** Backend base URL (no trailing slash). Required. */
  backendUrl: string;
  /** Progress updates. */
  onProgress?: (p: OcrProgress) => void;
  /** Pass an AbortSignal to cancel an in-flight request. */
  signal?: AbortSignal;
  /** Optional progressive-text callback. When provided, the request
   *  opts into the backend's SSE contract (``Accept: text/event-stream``)
   *  and this fires every time more text arrives — argument is the
   *  full accumulated text so far, not the latest delta, so UIs can
   *  bind it to a textarea / popover without keeping their own buffer.
   *  Absent → use the one-shot JSON contract. */
  onPartial?: (text: string) => void;
}

export class OcrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OcrError";
  }
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/** True if the value looks like an image File/Blob the side panel can OCR. */
export const isImageBlob = (b: { type?: string }): boolean =>
  typeof b.type === "string" && b.type.startsWith("image/");

/** Pick the first image File/Blob out of a clipboard / drag DataTransfer
 *  set. Returns null if nothing image-shaped is present. */
export function firstImageFrom(items: DataTransferItemList | null | undefined): Blob | null {
  if (!items) return null;
  for (const item of Array.from(items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

/**
 * Read text out of an image by POSTing it to the configured backend's
 * `/api/v1/ocr` endpoint. Throws `OcrError` with a UX-ready message on
 * any failure (bad input, network, non-OK status, empty recognition).
 *
 * The image always passes through a client-side preprocessing step
 * before upload (see {@link preprocessImage}): EXIF orientation is
 * baked into pixels, oversized images are downscaled to the vision
 * model's effective resolution, and exotic formats (HEIC, BMP, …) are
 * normalised to JPEG. This keeps the wire payload small, removes the
 * "sideways photo" failure mode, and lifts the practical input-size
 * ceiling well past the 8 MB backend cap.
 */
export async function extractTextFromImage(
  source: OcrSource,
  options: OcrOptions,
): Promise<string> {
  validateInput(source);

  options.onProgress?.({ status: "Preparing image", progress: null });

  const prepared = await preprocessImage(source);
  if (prepared.size > LIMITS.MAX_OCR_IMAGE_BYTES) {
    // Should be vanishingly rare — the preprocessor caps the longest
    // edge so the re-encoded JPEG comfortably fits the backend limit.
    // If it ever happens, fail clearly rather than gambling on a 413.
    const mb = Math.round(LIMITS.MAX_OCR_IMAGE_BYTES / (1024 * 1024));
    throw new OcrError(`Image is still over ${mb} MB after compression — try a smaller crop.`);
  }

  options.onProgress?.({ status: "Uploading image", progress: null });

  const { base64, mimeType } = await blobToBase64(prepared);
  const payload: OcrRequest = { imageBase64: base64, mimeType };

  const wantsStream = typeof options.onPartial === "function";

  let resp: Response;
  try {
    resp = await fetch(`${options.backendUrl}/api/v1/ocr`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Content-negotiate: opt into the SSE contract only when the
        // caller has wired up a progressive-text callback. The default
        // JSON contract is kept for callers (background script's
        // right-click flow, headless usages) that want the whole
        // result in one shot.
        Accept: wantsStream ? "text/event-stream" : "application/json",
      },
      body: JSON.stringify(payload),
      // `fetch`'s RequestInit.signal is `AbortSignal | null`, not
      // `| undefined` — under exactOptionalPropertyTypes the two are
      // distinct, so only pass the field when we have a real signal.
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch {
    throw new OcrError("Couldn't reach the OCR backend. Check Settings → Backend.");
  }

  if (!resp.ok) {
    // Pre-flight errors (rate limit, payload too large, validation)
    // come back as JSON on both Accept variants — the streaming branch
    // only kicks in after pre-flight passes.
    let detail = "";
    try {
      const body = (await resp.json()) as { error?: { message?: string } };
      detail = body?.error?.message ?? "";
    } catch {
      /* non-JSON error body — ignore */
    }
    throw new OcrError(detail || `Backend OCR returned ${resp.status}.`);
  }

  options.onProgress?.({ status: "Recognising", progress: null });

  // Branch on the actual response Content-Type rather than what we
  // *asked for*, so a backend version that doesn't yet support SSE
  // still works — it just answers JSON, and we honour that.
  const contentType = resp.headers.get("content-type") ?? "";
  if (wantsStream && contentType.includes("text/event-stream")) {
    return await consumeOcrSseStream(resp, options.onPartial!);
  }

  let data: OcrResponse;
  try {
    data = (await resp.json()) as OcrResponse;
  } catch {
    throw new OcrError("Backend OCR returned an unparseable response.");
  }

  const text = (data?.text ?? "").trim();
  if (!text) {
    throw new OcrError("No readable text was found in that image.");
  }
  return text;
}

// ---------------------------------------------------------------------------
// SSE consumer
// ---------------------------------------------------------------------------

/**
 * Read SSE frames off the response body, accumulate ``token`` deltas,
 * surface them progressively via ``onPartial``, and return the final
 * text on ``done``. ``error`` frames are translated into ``OcrError``
 * so callers handle them the same way as JSON-path failures.
 *
 * The parser is a deliberately tiny line-buffered state machine —
 * matches the one in :file:`background/api-client.ts` and is enough
 * for the events the backend produces (``token``, ``error``, ``done``,
 * plus heartbeat comment frames which are skipped).
 */
async function consumeOcrSseStream(
  resp: Response,
  onPartial: (text: string) => void,
): Promise<string> {
  if (!resp.body) {
    throw new OcrError("Backend OCR returned an empty stream.");
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  let streamError: string | null = null;
  let sawDone = false;

  try {
    while (!sawDone) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const evt = parseSseFrame(raw);
        if (!evt) continue;

        if (evt.event === "token") {
          const delta = safeJsonField<string>(evt.data, "delta");
          if (delta) {
            accumulated += delta;
            onPartial(accumulated);
          }
        } else if (evt.event === "error") {
          streamError =
            safeJsonField<string>(evt.data, "message") || "The OCR model returned an error.";
          // Continue draining so the connection closes cleanly; we
          // throw once the stream finishes.
        } else if (evt.event === "done") {
          sawDone = true;
          break;
        }
      }
    }
  } finally {
    // Always release the lock so the response can be garbage-collected
    // promptly, even if the consumer throws partway through.
    reader.releaseLock();
  }

  if (streamError) throw new OcrError(streamError);
  const text = accumulated.trim();
  if (!text) throw new OcrError("No readable text was found in that image.");
  return text;
}

/** Parse one SSE frame (the chunk between two ``\n\n`` delimiters)
 *  into its event name and concatenated data payload. Returns null
 *  when the frame carries no data lines (e.g. heartbeat comments). */
function parseSseFrame(raw: string): { event: string; data: string } | null {
  let event = "message";
  let data = "";
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith(":")) continue; // blank / comment
    if (line.startsWith("event: ")) event = line.slice(7).trim();
    else if (line.startsWith("data: ")) data += line.slice(6);
  }
  return data ? { event, data } : null;
}

/** Pluck a single string field from an SSE ``data:`` payload, never
 *  throwing — a malformed frame just yields ``undefined`` so the
 *  stream stays alive. */
function safeJsonField<T>(raw: string, key: string): T | undefined {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed[key] as T | undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateInput(source: OcrSource): void {
  if (!isImageBlob(source)) {
    throw new OcrError("That file isn't an image — drop a PNG, JPG, or screenshot instead.");
  }
  if (source.size > LIMITS.MAX_OCR_INPUT_BYTES) {
    const mb = Math.round(LIMITS.MAX_OCR_INPUT_BYTES / (1024 * 1024));
    throw new OcrError(`Image is too large (over ${mb} MB) — try a smaller screenshot.`);
  }
}

// ---------------------------------------------------------------------------
// Preprocessing
// ---------------------------------------------------------------------------

// Vision models internally tile high-res images at ~768 px patches, so
// anything past ~2,560 px on the longest edge spends bytes for no
// accuracy gain. Capping here means a 4K screenshot or 12-megapixel
// phone photo round-trips as a ~500 KB JPEG instead of 8+ MB of base64.
const MAX_EDGE_PX = 2560;

// JPEG quality just below visually lossless. High enough that small UI
// text and 1-pixel strokes survive recompression; low enough that the
// post-encode size is a fraction of the source.
const REENCODE_QUALITY = 0.92;

// MIME types the backend already accepts as-is. Anything outside this
// set (HEIC, BMP, TIFF, AVIF, …) is normalised to JPEG by the canvas
// re-encode. Kept narrow to match `OCR_MIME_TYPES`.
const PASSTHROUGH_MIME = new Set<string>(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/**
 * Decode → orient → optionally downscale → re-encode an image so the
 * upload is small, oriented correctly, and in a MIME type the backend
 * accepts.
 *
 * `createImageBitmap` does the heavy lifting: it decodes anything the
 * browser knows how to decode (PNG, JPEG, WebP, GIF, AVIF, and HEIC/
 * HEIF on platforms where Chrome supports it), and `imageOrientation:
 * "from-image"` applies the EXIF rotation tag so iPhone photos come
 * out the right way up without us shipping an EXIF parser.
 *
 * Why we *always* re-encode rather than passing small JPEGs straight
 * through: the EXIF orientation tag is only consumed during decode, so
 * passing the original blob to the model leaves the rotation embedded
 * in metadata it may or may not honour. A canvas re-encode bakes the
 * orientation into pixels — deterministic, model-independent. The CPU
 * cost is ~tens of ms for typical screenshots.
 */
async function preprocessImage(source: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
  } catch {
    throw new OcrError("Couldn't decode that image — try a PNG, JPG, or WebP.");
  }

  try {
    const { width, height } = bitmap;
    if (width === 0 || height === 0) {
      throw new OcrError("That image has no pixels to read.");
    }

    const longest = Math.max(width, height);
    const scale = longest > MAX_EDGE_PX ? MAX_EDGE_PX / longest : 1;
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    const { canvas, ctx } = makeCanvas2D(targetW, targetH);

    // White fill so transparent PNGs become black-on-white instead of
    // black-on-black after JPEG conversion (JPEG has no alpha channel).
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);

    // Pick the output MIME. JPEG by default — smallest payload with
    // negligible accuracy loss for text. PNGs that are already small
    // and within the passthrough set are kept as PNG so vector-style
    // screenshots (sharp UI text on solid backgrounds) don't pick up
    // JPEG ringing artefacts.
    const keepPng =
      source.type === "image/png" &&
      scale === 1 &&
      source.size <= LIMITS.MAX_OCR_IMAGE_BYTES &&
      PASSTHROUGH_MIME.has(source.type);
    const outType = keepPng ? "image/png" : "image/jpeg";
    const outQuality = keepPng ? undefined : REENCODE_QUALITY;

    return await canvasToBlob(canvas, outType, outQuality);
  } finally {
    bitmap.close();
  }
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type AnyCanvas2DContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/** Construct a 2D-drawable canvas + its context together so callers
 *  don't have to narrow the union return type from `getContext`. */
function makeCanvas2D(
  width: number,
  height: number,
): { canvas: AnyCanvas; ctx: AnyCanvas2DContext } {
  if (typeof OffscreenCanvas !== "undefined") {
    const c = new OffscreenCanvas(width, height);
    const ctx = c.getContext("2d");
    if (!ctx) {
      throw new OcrError("Couldn't prepare image for OCR (canvas unavailable).");
    }
    return { canvas: c, ctx };
  }
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");
  if (!ctx) {
    throw new OcrError("Couldn't prepare image for OCR (canvas unavailable).");
  }
  return { canvas: c, ctx };
}

async function canvasToBlob(
  canvas: AnyCanvas,
  type: string,
  quality: number | undefined,
): Promise<Blob> {
  if ("convertToBlob" in canvas) {
    // OffscreenCanvas.convertToBlob ignores `quality` for non-JPEG/WebP
    // types, so passing it unconditionally is safe.
    return canvas.convertToBlob(
      quality === undefined ? { type } : { type, quality },
    );
  }
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new OcrError("Couldn't encode the prepared image."))),
      type,
      quality,
    );
  });
}

async function blobToBase64(blob: Blob): Promise<{ base64: string; mimeType: OcrMimeType }> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return { base64: btoa(binary), mimeType: normalizeMimeType(blob.type) };
}

function normalizeMimeType(raw: string): OcrMimeType {
  const lower = raw.toLowerCase();
  if ((OCR_MIME_TYPES as readonly string[]).includes(lower)) {
    return lower as OcrMimeType;
  }
  // Browsers occasionally hand us "image/jpg" instead of "image/jpeg".
  if (lower === "image/jpg") return "image/jpeg";
  // Unknown types fall back to PNG — the most permissive vision-model
  // decoder. The backend validates this again, so a truly bogus image
  // still gets a 400 rather than an opaque upstream failure.
  return "image/png";
}
