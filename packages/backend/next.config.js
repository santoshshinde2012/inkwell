/** @type {import('next').NextConfig} */

// Strict security headers applied to every response. Notes on each:
//
// - HSTS pre-loads the browser into HTTPS-only mode for 2 years incl. subdomains.
//   Vercel terminates TLS for us, so this is safe to set.
// - X-Content-Type-Options blocks MIME sniffing — eliminates a class of XSS.
// - X-Frame-Options: DENY prevents clickjacking. Our APIs don't render in iframes.
// - Referrer-Policy keeps cross-origin leakage minimal.
// - Permissions-Policy denies unused powerful APIs by default.
// - CSP is conservative for our pages; the only HTML is a static landing
//   page that needs no inline scripts. We do NOT control extension CSP from
//   here (that's the extension manifest's job).
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Ensure the workspace shared package is transpiled when imported from
  // node_modules through the workspace symlink.
  transpilePackages: ["@inkwell/shared"],
  experimental: {
    typedRoutes: false,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
