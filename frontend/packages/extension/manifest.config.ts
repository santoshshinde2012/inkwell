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

    // Brand icons — rasterised from icons/logo.svg (see scripts/generate-icons.sh).
    // Chrome requires raster (PNG) icons; a 128px icon is mandatory to publish
    // on the Chrome Web Store.
    icons: {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png",
    },

    action: {
      default_title: "Inkwell — multilingual writing assistant",
      // No default_popup: clicking the toolbar icon opens the Chrome Side
      // Panel instead, so the assistant stays open alongside the page.
      // The background worker pairs this with
      //   chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
      // so a single action click reveals the side panel.
      default_icon: {
        "16": "icons/icon-16.png",
        "32": "icons/icon-32.png",
        "48": "icons/icon-48.png",
        "128": "icons/icon-128.png",
      },
    },
    options_page: "src/options/index.html",

    // The persistent assistant lives in Chrome's Side Panel — a first-class
    // right-side dock that stays open while the user browses. Requires
    // Chrome 114+ and the "sidePanel" permission below.
    side_panel: {
      default_path: "src/sidepanel/index.html",
    },

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

    permissions: [
      "storage",
      "scripting",
      "activeTab",
      "sidePanel",
      // contextMenus is needed for "Extract text with Inkwell" on
      // right-clicked images. Click handler lives in the background worker
      // (src/background/index.ts) and routes the image into the side panel.
      "contextMenus",
    ],

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
        description: "Open Inkwell on the focused field, selected text, or a blank draft",
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
