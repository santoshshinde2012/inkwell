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
  MESSAGE_TYPES,
  type MessageType,
} from "@inkwell/shared";
import { cancelStream, handleCompleteStream } from "./api-client";
import { evaluateSite } from "../lib/site-policy";

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install" && !__DEV__) {
    chrome.runtime.openOptionsPage().catch(() => {});
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open-popover") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs
    .sendMessage(tab.id, { type: "OPEN_POPOVER_AT_FOCUS" })
    .catch(() => {
      // Content script may not be loaded on chrome:// pages, etc.
    });
});

// ---------------------------------------------------------------------------
// Handler registry
// ---------------------------------------------------------------------------

type HandlerResult = unknown | Promise<unknown>;
type Handler = (
  msg: unknown,
  sender: chrome.runtime.MessageSender,
) => HandlerResult;

const handleCompleteStart: Handler = (rawMsg, sender) => {
  const parsed = CompleteStartMessageSchema.safeParse(rawMsg);
  if (!parsed.success) return { ok: false, error: parsed.error.flatten() };
  if (sender.tab?.id == null) {
    return {
      ok: false,
      error: {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "Stream requires a tab sender",
      },
    };
  }
  // Streaming response: ack immediately; tokens flow back to the content
  // script via tabs.sendMessage.
  void handleCompleteStream({
    message: parsed.data,
    senderTabId: sender.tab.id,
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

const HANDLERS: Partial<Record<MessageType, Handler>> = {
  [MESSAGE_TYPES.COMPLETE_START]: handleCompleteStart,
  [MESSAGE_TYPES.COMPLETE_CANCEL]: handleCompleteCancel,
  [MESSAGE_TYPES.CHECK_SITE_ALLOWED]: handleCheckSiteAllowed,
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
