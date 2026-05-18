import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

// Minimal MV3 manifest. Notes on each decision:
//
// - permissions: only what we strictly need.
//   - "storage" — chrome.storage.local holds all user settings (Inkwell
//     has no auth, so there are no tokens to store).
//   - "scripting" — for activeTab-targeted scripting (no programmatic injection into other tabs).
//   - "activeTab" — implicit grant for the current tab when the user invokes the extension.
//
// - host_permissions: enumerated per-site for adapters (Gmail/LinkedIn/X/Slack/Outlook).
//   We deliberately avoid <all_urls> host permissions. The content script
//   matches every page but only activates after a user gesture (trigger
//   click / shortcut), limited by the per-site allow/blocklist in code.
//
// - host_permissions also includes the backend origin so the background
//   worker can call our API. It is derived from VITE_BACKEND_URL, resolved
//   by vite.config.ts (which reads .env files via loadEnv) and passed into
//   buildManifest() — keep this a function so the URL is injected, not
//   read from process.env at module-load time.
//
// - CSP: extension_pages CSP allows only self-hosted scripts. No remote code,
//   no inline. The popup/options pages bundle their own scripts via Vite.

/**
 * Build the MV3 manifest for a given backend URL. Called by vite.config.ts
 * after it has resolved VITE_BACKEND_URL from the environment / .env files.
 */
export const buildManifest = (backendUrl: string) => {
  const backendOrigin = new URL(backendUrl).origin + "/*";

  return defineManifest({
    manifest_version: 3,
    name: "Inkwell",
    description:
      "Translate customer queries and draft, fix, and rewrite replies in any language — streaming, secure, no auto-send.",
    version: pkg.version,

    action: {
      default_title: "Inkwell — multilingual writing assistant",
      default_popup: "src/popup/index.html",
    },
    options_page: "src/options/index.html",

    background: {
      service_worker: "src/background/index.ts",
      type: "module",
    },

    content_scripts: [
      {
        matches: ["<all_urls>"],
        // Despite the broad match, the content script only activates on sites
        // present in the user's allowlist (or a bundled adapter site).
        // Sensitive hosts like banks/healthcare/password managers are blocked
        // by default. See src/lib/site-policy.ts.
        js: ["src/content/index.ts"],
        run_at: "document_idle",
        all_frames: false,
      },
    ],

    permissions: ["storage", "scripting", "activeTab"],

    host_permissions: [
      backendOrigin,
      "https://mail.google.com/*",
      "https://outlook.live.com/*",
      "https://outlook.office.com/*",
      "https://outlook.office365.com/*",
      "https://www.linkedin.com/*",
      "https://x.com/*",
      "https://twitter.com/*",
      "https://app.slack.com/*",
      "https://web.whatsapp.com/*",
    ],

    // The default backend above works out of the box. When the user points
    // the extension at their own backend (options → Backend), the options
    // page calls chrome.permissions.request() for that exact origin — which
    // must be covered by optional_host_permissions. We request the specific
    // origin, never the wildcard, so the granted permission stays narrow.
    optional_host_permissions: ["https://*/*", "http://*/*"],

    commands: {
      "open-popover": {
        suggested_key: {
          default: "Ctrl+Shift+K",
          mac: "Command+Shift+K",
        },
        description:
          "Open Inkwell on the focused field, selected text, or a blank draft",
      },
    },

    content_security_policy: {
      // No remote scripts; tightest practical CSP for MV3.
      extension_pages: "script-src 'self'; object-src 'self'; base-uri 'self';",
    },

    web_accessible_resources: [
      {
        resources: ["src/ui/popover.css"],
        matches: ["<all_urls>"],
      },
    ],
  });
};
