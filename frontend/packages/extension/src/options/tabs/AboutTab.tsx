// AboutTab — one tab of the options page.
//
// Composed by ./index.ts and routed to from options/App.tsx.

import { type JSX } from "react";
import { localStore } from "../../lib/storage";
import { Card } from "../components";

export function AboutTab(): JSX.Element {
  return (
    <>
      <Card title="What this is">
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          Inkwell translates customer queries, drafts replies, fixes grammar, and rewrites text on
          any text field on the web — across many languages, with a preview-before-insert flow so
          nothing is ever auto-sent.
        </p>
      </Card>
      <Card title="No account, no tracking">
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          Inkwell works without sign-in. Every setting on this page is stored only in your browser
          (chrome.storage.local) and never leaves your device, except the optional profile attached
          to a request to personalize a reply. Prompt content is never logged.
        </p>
      </Card>
      <Card title="Version">
        <p className="font-mono text-xs text-zinc-500 dark:text-zinc-400">1.1.0</p>
      </Card>
      <Card
        title="Reset"
        description="Clear every Inkwell setting and the translation history on this device, restoring defaults. This cannot be undone."
      >
        <button
          type="button"
          onClick={() => {
            if (
              !window.confirm(
                "Reset all Inkwell settings and clear history? This cannot be undone.",
              )
            ) {
              return;
            }
            void localStore.clearAll().then(() => window.location.reload());
          }}
          className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-red-500 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
        >
          Reset all settings
        </button>
      </Card>
    </>
  );
}
