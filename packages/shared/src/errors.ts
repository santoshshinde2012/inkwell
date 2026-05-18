// Stable, machine-readable error codes returned by the backend and re-emitted
// across `chrome.runtime` message channels. The extension UI maps these codes
// to user-friendly copy; never expose raw error objects to the popover.

export const ERROR_CODES = {
  // Authorization / policy
  FORBIDDEN: "FORBIDDEN",
  ORIGIN_NOT_ALLOWED: "ORIGIN_NOT_ALLOWED",
  SITE_BLOCKED: "SITE_BLOCKED",

  // Input
  VALIDATION_FAILED: "VALIDATION_FAILED",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",

  // Limits / availability
  RATE_LIMITED: "RATE_LIMITED",
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
  TIMEOUT: "TIMEOUT",

  // Streaming
  STREAM_ABORTED: "STREAM_ABORTED",

  // Catch-alls
  INTERNAL_ERROR: "INTERNAL_ERROR",
  NETWORK_ERROR: "NETWORK_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ApiError {
  code: ErrorCode;
  message: string;
  // Hint for the UI: should we offer a retry, sign-in, or just show the
  // error? Driven by the code, but materialized server-side so the client
  // doesn't need a giant switch.
  retryable: boolean;
  // Optional details — never include sensitive content here.
  details?: Record<string, unknown>;
}

const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  ERROR_CODES.UPSTREAM_ERROR,
  ERROR_CODES.TIMEOUT,
  ERROR_CODES.NETWORK_ERROR,
  ERROR_CODES.STREAM_ABORTED,
]);

export const isRetryable = (code: ErrorCode): boolean => RETRYABLE.has(code);

export const apiError = (
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ApiError => ({
  code,
  message,
  retryable: isRetryable(code),
  ...(details ? { details } : {}),
});
