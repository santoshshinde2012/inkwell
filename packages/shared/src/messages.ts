// Message contracts for chrome.runtime.sendMessage between content script,
// background service worker, popup, and options page. These are the only
// shapes any context should send or receive — every handler validates with
// the matching zod schema before acting.

import { z } from "zod";
import { ACTIONS } from "./actions";
import { TONE_PRESETS } from "./tones";
import { MODEL_IDS } from "./models";
import { LANGUAGE_IDS, SOURCE_LANGUAGE_IDS } from "./languages";
import { ContextSchema, SseUsagePayloadSchema } from "./schemas";
import { ERROR_CODES } from "./errors";

// Each message is discriminated on `type`. Background routes by `type` and
// validates the rest of the payload via the matching schema.
//
// The extension has no authentication — there are no AUTH_* messages. All
// user settings live in chrome.storage.local and are read directly by the
// context that needs them.
export const MESSAGE_TYPES = {
  // Content -> Background
  COMPLETE_START: "COMPLETE_START",
  COMPLETE_CANCEL: "COMPLETE_CANCEL",

  // Background -> Content (streamed back per token)
  COMPLETE_TOKEN: "COMPLETE_TOKEN",
  COMPLETE_DONE: "COMPLETE_DONE",
  COMPLETE_ERROR: "COMPLETE_ERROR",
  COMPLETE_USAGE: "COMPLETE_USAGE",

  // Site policy lookup (Content -> Background)
  CHECK_SITE_ALLOWED: "CHECK_SITE_ALLOWED",

  // Content -> Background: open the Chrome Side Panel for the current tab,
  // carrying the popover's working text + per-request settings so the user
  // can continue without retyping. The background must call
  // chrome.sidePanel.open synchronously to preserve the user gesture from
  // the popover button click.
  OPEN_SIDE_PANEL_FROM_POPOVER: "OPEN_SIDE_PANEL_FROM_POPOVER",
} as const;

export type MessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];

// ---- Streaming completion (the hot path) -----------------------------------

export const CompleteStartMessageSchema = z.object({
  type: z.literal(MESSAGE_TYPES.COMPLETE_START),
  // The content script generates this and the background uses it as the SSE
  // stream id, so it must be unique per in-flight request.
  streamId: z.string().uuid(),
  payload: z.object({
    action: z.enum(ACTIONS),
    context: ContextSchema,
    tone: z.enum(TONE_PRESETS).optional(),
    instruction: z.string().max(1000).optional(),
    model: z.enum(MODEL_IDS).optional(),
    // Language controls forwarded verbatim to /api/v1/complete — see the
    // matching fields on CompleteRequestSchema in ./schemas.
    sourceLanguage: z.enum(SOURCE_LANGUAGE_IDS).optional(),
    targetLanguage: z.enum(LANGUAGE_IDS).optional(),
    bilingual: z.boolean().optional(),
  }),
});
export type CompleteStartMessage = z.infer<typeof CompleteStartMessageSchema>;

export const CompleteCancelMessageSchema = z.object({
  type: z.literal(MESSAGE_TYPES.COMPLETE_CANCEL),
  streamId: z.string().uuid(),
});
export type CompleteCancelMessage = z.infer<typeof CompleteCancelMessageSchema>;

export const CompleteTokenMessageSchema = z.object({
  type: z.literal(MESSAGE_TYPES.COMPLETE_TOKEN),
  streamId: z.string().uuid(),
  delta: z.string(),
});
export type CompleteTokenMessage = z.infer<typeof CompleteTokenMessageSchema>;

export const CompleteDoneMessageSchema = z.object({
  type: z.literal(MESSAGE_TYPES.COMPLETE_DONE),
  streamId: z.string().uuid(),
});
export type CompleteDoneMessage = z.infer<typeof CompleteDoneMessageSchema>;

export const CompleteUsageMessageSchema = z.object({
  type: z.literal(MESSAGE_TYPES.COMPLETE_USAGE),
  streamId: z.string().uuid(),
  usage: SseUsagePayloadSchema,
});
export type CompleteUsageMessage = z.infer<typeof CompleteUsageMessageSchema>;

export const CompleteErrorMessageSchema = z.object({
  type: z.literal(MESSAGE_TYPES.COMPLETE_ERROR),
  streamId: z.string().uuid(),
  error: z.object({
    code: z.nativeEnum(ERROR_CODES),
    message: z.string(),
    retryable: z.boolean(),
  }),
});
export type CompleteErrorMessage = z.infer<typeof CompleteErrorMessageSchema>;

// ---- Site policy ------------------------------------------------------------

export const CheckSiteAllowedMessageSchema = z.object({
  type: z.literal(MESSAGE_TYPES.CHECK_SITE_ALLOWED),
  hostname: z.string().min(1).max(253),
});
export type CheckSiteAllowedMessage = z.infer<
  typeof CheckSiteAllowedMessageSchema
>;

export const CheckSiteAllowedResponseSchema = z.object({
  allowed: z.boolean(),
  reason: z.enum(["default", "allowlist", "blocklist", "blocked-by-default"]),
});
export type CheckSiteAllowedResponse = z.infer<
  typeof CheckSiteAllowedResponseSchema
>;

// ---- Hand-off from popover to side panel ----------------------------------

export const OpenSidePanelFromPopoverMessageSchema = z.object({
  type: z.literal(MESSAGE_TYPES.OPEN_SIDE_PANEL_FROM_POPOVER),
  /** Text the user was working on inside the popover, if any. The side
   *  panel pre-fills its input from this. Capped to a sane size so the
   *  storage write isn't an attack vector for huge payloads. */
  text: z.string().max(20_000).optional(),
  /** Action the user had selected at the moment they clicked "Open in
   *  side panel". The side panel honours it instead of last-used. */
  action: z.enum(ACTIONS).optional(),
});
export type OpenSidePanelFromPopoverMessage = z.infer<
  typeof OpenSidePanelFromPopoverMessageSchema
>;

// ---- Discriminated unions for runtime routing ------------------------------

export const ExtensionMessageSchema = z.discriminatedUnion("type", [
  CompleteStartMessageSchema,
  CompleteCancelMessageSchema,
  CompleteTokenMessageSchema,
  CompleteDoneMessageSchema,
  CompleteUsageMessageSchema,
  CompleteErrorMessageSchema,
  CheckSiteAllowedMessageSchema,
  OpenSidePanelFromPopoverMessageSchema,
]);
export type ExtensionMessage = z.infer<typeof ExtensionMessageSchema>;

// Sites blocked out of the box. Users can remove these from their blocklist
// in the options page if they really want to, but the default is restrictive.
export const DEFAULT_BLOCKED_HOSTS: readonly string[] = [
  // Banking / finance
  "chase.com",
  "bankofamerica.com",
  "wellsfargo.com",
  "citi.com",
  "capitalone.com",
  "americanexpress.com",
  "paypal.com",
  "stripe.com",
  // Healthcare / pharmacy
  "mychart.com",
  "cvs.com",
  "walgreens.com",
  // Password managers
  "1password.com",
  "lastpass.com",
  "bitwarden.com",
  "dashlane.com",
  // Government / sensitive
  "irs.gov",
  "usa.gov",
  "ssa.gov",
];
