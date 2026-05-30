// Background API client. Owns the SSE connection to /api/v1/complete and
// shuttles tokens to the originating tab's content script.
//
// The backend URL and an optional API key are user-configurable (options
// page → Backend) and read from chrome.storage.local per request, so the
// extension can talk to any compatible backend — see
// docs/how-to/use-your-own-backend.md. The default Inkwell backend needs
// no key; a custom backend gets `Authorization: Bearer <apiKey>` when one
// is set. Personalization (display name / about-me) is also attached.

import {
  CompleteStartMessage,
  CompleteTokenMessage,
  CompleteDoneMessage,
  CompleteErrorMessage,
  CompleteUsageMessage,
  ERROR_CODES,
  ErrorCode,
  MESSAGE_TYPES,
  SSE,
  SseTokenPayload,
  SseUsagePayload,
  SseErrorPayload,
} from "@inkwell/shared";
import { localStore } from "../lib/storage";

const inFlight = new Map<string, AbortController>();

// Where to deliver streamed tokens. Content scripts (the in-page popover)
// live in a tab and receive via tabs.sendMessage; extension-page callers
// (the side panel) have no tab id, so we broadcast via runtime.sendMessage
// and the page listens for its own stream id.
export type ResponseTarget = { kind: "tab"; tabId: number } | { kind: "runtime" };

interface HandleArgs {
  message: CompleteStartMessage;
  target: ResponseTarget;
}

const sendToTarget = (target: ResponseTarget, msg: object): void => {
  const abortOnFail = (): void => {
    const ctrl = inFlight.get((msg as { streamId?: string }).streamId ?? "");
    ctrl?.abort();
  };
  if (target.kind === "tab") {
    chrome.tabs.sendMessage(target.tabId, msg).catch(abortOnFail);
  } else {
    chrome.runtime.sendMessage(msg).catch(abortOnFail);
  }
};

export const cancelStream = (streamId: string): void => {
  inFlight.get(streamId)?.abort();
};

export const handleCompleteStream = async ({ message, target }: HandleArgs): Promise<void> => {
  const ctrl = new AbortController();
  inFlight.set(message.streamId, ctrl);

  const sendError = (code: ErrorCode, msg: string, retryable: boolean): void => {
    const out: CompleteErrorMessage = {
      type: MESSAGE_TYPES.COMPLETE_ERROR,
      streamId: message.streamId,
      error: { code, message: msg, retryable },
    };
    sendToTarget(target, out);
  };

  // Hoisted so the catch block can name the backend in its error message.
  let backendUrl = "the backend";

  try {
    // Backend config, personalization, and default model all come from
    // local storage. Profile is omitted entirely when the user hasn't set
    // a display name or "about me".
    const settings = await localStore.getAll();
    backendUrl = settings.backendUrl;
    const profile: { displayName?: string; aboutMe?: string } = {};
    if (settings.displayName.trim()) profile.displayName = settings.displayName.trim();
    if (settings.aboutMe.trim()) profile.aboutMe = settings.aboutMe.trim();
    const hasProfile = !!(profile.displayName || profile.aboutMe);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "X-Client-Request-Id": message.streamId,
    };
    // Only attach an Authorization header when the user has set a key for
    // their own backend. The default Inkwell backend ignores it.
    if (settings.apiKey) {
      headers["Authorization"] = `Bearer ${settings.apiKey}`;
    }

    const res = await fetch(`${settings.backendUrl}/api/v1/complete`, {
      method: "POST",
      signal: ctrl.signal,
      headers,
      body: JSON.stringify({
        action: message.payload.action,
        context: message.payload.context,
        tone: message.payload.tone,
        instruction: message.payload.instruction,
        // The popover may pin a model; otherwise use the user's default.
        model: message.payload.model ?? settings.defaultModel,
        // Language controls — forwarded as-is; omitted when unset so the
        // request body stays minimal.
        ...(message.payload.sourceLanguage
          ? { sourceLanguage: message.payload.sourceLanguage }
          : {}),
        ...(message.payload.targetLanguage
          ? { targetLanguage: message.payload.targetLanguage }
          : {}),
        ...(message.payload.bilingual ? { bilingual: true } : {}),
        ...(message.payload.history && message.payload.history.length > 0
          ? { history: message.payload.history }
          : {}),
        ...(hasProfile ? { profile } : {}),
        clientRequestId: message.streamId,
      }),
    });

    if (!res.ok) {
      let code: ErrorCode = ERROR_CODES.UPSTREAM_ERROR;
      let text = `Backend returned ${res.status}`;
      try {
        const body = (await res.json()) as {
          error?: { code?: ErrorCode; message?: string };
        };
        if (body?.error?.code) code = body.error.code;
        if (body?.error?.message) text = body.error.message;
      } catch {
        // ignore — keep the generic message
      }
      // The most common first-run failure: the backend doesn't know this
      // extension's origin. Tell the user the exact value to add.
      if (code === ERROR_CODES.ORIGIN_NOT_ALLOWED) {
        text =
          `The backend rejected this extension's origin. Add ` +
          `"chrome-extension://${chrome.runtime.id}" to the backend's ` +
          `ALLOWED_EXTENSION_IDS environment variable, then restart it.`;
      }
      sendError(code, text, false);
      return;
    }

    if (!res.body) {
      sendError(ERROR_CODES.UPSTREAM_ERROR, "Empty response body", true);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        handleSseEvent(raw, message.streamId, target);
      }
    }
  } catch {
    if (ctrl.signal.aborted) return; // cancelled by the user
    // A failed fetch (connection refused, DNS, CORS block) lands here.
    // The raw "Failed to fetch" is useless to the user, so give an
    // actionable message naming the backend and how to fix it.
    sendError(
      ERROR_CODES.NETWORK_ERROR,
      `Couldn't reach the backend at ${backendUrl}. Make sure it is running ` +
        `and reachable — then try again. You can change the backend URL in ` +
        `Inkwell's options (right-click the toolbar icon → Options → Backend).`,
      true,
    );
  } finally {
    inFlight.delete(message.streamId);
  }
};

const handleSseEvent = (raw: string, streamId: string, target: ResponseTarget): void => {
  let event = "message";
  let data = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith(":")) continue; // comment
    if (line.startsWith("event: ")) event = line.slice(7).trim();
    else if (line.startsWith("data: ")) data += line.slice(6);
  }
  if (!data) return;

  try {
    const parsed = JSON.parse(data) as unknown;
    switch (event) {
      case SSE.EVENT_TOKEN: {
        const p = parsed as SseTokenPayload;
        const out: CompleteTokenMessage = {
          type: MESSAGE_TYPES.COMPLETE_TOKEN,
          streamId,
          delta: p.delta,
        };
        sendToTarget(target, out);
        return;
      }
      case SSE.EVENT_USAGE: {
        const p = parsed as SseUsagePayload;
        const out: CompleteUsageMessage = {
          type: MESSAGE_TYPES.COMPLETE_USAGE,
          streamId,
          usage: p,
        };
        sendToTarget(target, out);
        return;
      }
      case SSE.EVENT_ERROR: {
        const p = parsed as SseErrorPayload;
        const out: CompleteErrorMessage = {
          type: MESSAGE_TYPES.COMPLETE_ERROR,
          streamId,
          error: p,
        };
        sendToTarget(target, out);
        return;
      }
      case SSE.EVENT_DONE: {
        const out: CompleteDoneMessage = {
          type: MESSAGE_TYPES.COMPLETE_DONE,
          streamId,
        };
        sendToTarget(target, out);
        return;
      }
      default:
        return;
    }
  } catch {
    // Ignore malformed events rather than tearing down the whole stream.
  }
};
