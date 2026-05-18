import { allowedExtensionOrigins, env } from "./env";

// CORS lockdown. The extension is the *only* legitimate cross-origin caller of
// /api/v1/*. Anything else is rejected at the middleware layer.
//
// Why we don't use a wildcard:
//   - Wildcards make stolen tokens trivially exploitable from any page.
//   - The OpenAI key sits behind these routes, so blast radius is high.
//
// Why we allow same-origin:
//   - The Next.js auth callback page calls /api/v1/* during the OAuth dance.
//
// Why we allow localhost in dev:
//   - Convenience for `next dev` when poking endpoints with curl/Postman.

const SAME_ORIGIN = new URL(env.NEXT_PUBLIC_APP_URL).origin;
const IS_DEV = !env.NODE_ENV.startsWith("prod");
const DEV_LOOPBACKS: readonly string[] = IS_DEV
  ? ["http://localhost:3000", "http://127.0.0.1:3000"]
  : [];

export const isOriginAllowed = (origin: string | null): boolean => {
  if (!origin) {
    // Server-to-server (no Origin header) is allowed for things like
    // health checks. Browser-initiated requests always send Origin.
    return true;
  }
  if (origin === SAME_ORIGIN) return true;
  if (DEV_LOOPBACKS.includes(origin)) return true;
  if (allowedExtensionOrigins.includes(origin)) return true;
  // In development, accept ANY Chrome extension origin so the extension
  // works the moment it is loaded — no need to copy its (unstable, unpacked)
  // ID into ALLOWED_EXTENSION_IDS first. Production keeps the strict
  // allowlist: there, an extension origin must be listed explicitly.
  if (IS_DEV && origin.startsWith("chrome-extension://")) return true;
  return false;
};

export const buildCorsHeaders = (origin: string | null): Headers => {
  const headers = new Headers();
  if (origin && isOriginAllowed(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS",
    );
    headers.set(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, X-Client-Request-Id",
    );
    headers.set("Access-Control-Max-Age", "86400");
  }
  return headers;
};

export const buildPreflightResponse = (origin: string | null): Response => {
  const headers = buildCorsHeaders(origin);
  // Note: we always reply 204; if the origin isn't allowed we just don't set
  // the Allow-Origin header, which causes the browser to block the real
  // request. This avoids leaking which origins are allowed via status codes.
  return new Response(null, { status: 204, headers });
};
