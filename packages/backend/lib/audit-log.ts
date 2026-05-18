// Metadata-only request logging.
//
// There is no database — logs go to stdout as structured JSON, which
// Vercel (and any log drain you attach) picks up. We log only request
// metadata: action, model, token counts, size, latency, status. We never
// log prompt content, completion content, or any user-supplied free text.
//
// `clientKey` is the IP-derived rate-limit key — it is NOT a user account
// (there are none). It's recorded only so abuse can be correlated.

import { Action } from "@inkwell/shared";

export interface CompletionLogEvent {
  clientKey: string;
  action: Action;
  model: string;
  // Language identifiers only — never the text that was translated.
  sourceLanguage?: string;
  targetLanguage?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  requestBytes: number;
  durationMs: number;
  status: number;
  errorCode?: string;
  clientRequestId?: string;
}

/**
 * Record a completion event as a single structured JSON line. Synchronous
 * and never throws — logging must not break the user-visible response.
 */
export const logCompletion = (event: CompletionLogEvent): void => {
  try {
    // eslint-disable-next-line no-console
    console.info(
      JSON.stringify({
        kind: "log.completion",
        ts: new Date().toISOString(),
        ...event,
      }),
    );
  } catch {
    // Never let logging throw.
  }
};
