// Rate limiting.
//
// There is no authentication and no database, so we cannot rate-limit per
// user account. The next-best key is the client IP, taken from the
// `x-forwarded-for` header that Vercel (and most proxies) populate.
//
// The store is in-memory. Caveats, accepted deliberately:
//   - Counters reset on cold start.
//   - Counters are not shared across regions / instances.
// This is a best-effort burst guard for the OpenAI key, not a hard quota.
// A serverless instance stays warm for a few minutes, which is enough to
// blunt a runaway client. For a hard quota you would need a shared store.
//
// Two sliding windows are enforced together: 20/min and 500/day.

export interface RateLimitVerdict {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
}

const PER_MINUTE_LIMIT = 20;
const PER_DAY_LIMIT = 500;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Map<ipKey, request timestamps within the last day>.
const hits = new Map<string, number[]>();

// Opportunistic cleanup so the map doesn't grow unbounded for one-shot IPs.
let lastSweep = Date.now();
const SWEEP_INTERVAL_MS = 5 * MINUTE_MS;

const sweep = (now: number): void => {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, list] of hits) {
    const fresh = list.filter((t) => now - t < DAY_MS);
    if (fresh.length === 0) hits.delete(key);
    else hits.set(key, fresh);
  }
};

/**
 * Extract a stable client key from the request. Falls back to a shared
 * "unknown" bucket when no IP header is present (e.g., local curl) — that
 * bucket is intentionally strict-shared so a missing IP can't bypass.
 */
export const clientKeyFromRequest = (request: Request): string => {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
};

export const checkRateLimit = (clientKey: string): RateLimitVerdict => {
  const now = Date.now();
  sweep(now);

  const list = (hits.get(clientKey) ?? []).filter((t) => now - t < DAY_MS);
  const inMinute = list.filter((t) => now - t < MINUTE_MS).length;

  if (inMinute >= PER_MINUTE_LIMIT) {
    return {
      success: false,
      limit: PER_MINUTE_LIMIT,
      remaining: 0,
      reset: now + MINUTE_MS,
    };
  }
  if (list.length >= PER_DAY_LIMIT) {
    return {
      success: false,
      limit: PER_DAY_LIMIT,
      remaining: 0,
      reset: now + DAY_MS,
    };
  }

  list.push(now);
  hits.set(clientKey, list);
  return {
    success: true,
    limit: PER_MINUTE_LIMIT,
    remaining: PER_MINUTE_LIMIT - inMinute - 1,
    reset: now + MINUTE_MS,
  };
};
