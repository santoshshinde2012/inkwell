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
 */
export async function extractTextFromImage(
  source: OcrSource,
  options: OcrOptions,
): Promise<string> {
  validateInput(source);

  options.onProgress?.({ status: "Uploading image", progress: null });

  const { base64, mimeType } = await blobToBase64(source);
  const payload: OcrRequest = { imageBase64: base64, mimeType };

  let resp: Response;
  try {
    resp = await fetch(`${options.backendUrl}/api/v1/ocr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
// Helpers
// ---------------------------------------------------------------------------

function validateInput(source: OcrSource): void {
  if (!isImageBlob(source)) {
    throw new OcrError("That file isn't an image — drop a PNG, JPG, or screenshot instead.");
  }
  if (source.size > LIMITS.MAX_OCR_IMAGE_BYTES) {
    const mb = Math.round(LIMITS.MAX_OCR_IMAGE_BYTES / (1024 * 1024));
    throw new OcrError(`Image is too large (over ${mb} MB) — try a smaller screenshot.`);
  }
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
