import { useEffect, useState } from "react";
import {
  CheckSiteAllowedResponse,
  MESSAGE_TYPES,
  languageLabel,
} from "@inkwell/shared";
import { sendToBackground } from "../lib/messaging";
import { localStore } from "../lib/storage";

interface CurrentSite {
  hostname: string;
  allowed: boolean;
  reason: CheckSiteAllowedResponse["reason"];
}

const KBD_SHORTCUT = navigator.platform.includes("Mac")
  ? "⌘⇧K"
  : "Ctrl+Shift+K";

type BackendStatus = "checking" | "ok" | "down";

// No accounts, no sign-in — Inkwell works anonymously. The popup is a
// quick glance at backend health and the current site, plus a shortcut
// to settings.
export function App(): JSX.Element {
  const [currentSite, setCurrentSite] = useState<CurrentSite | null>(null);
  const [workingLanguage, setWorkingLanguage] = useState<string | null>(null);
  const [backend, setBackend] = useState<{ status: BackendStatus; url: string }>({
    status: "checking",
    url: "",
  });

  useEffect(() => {
    void loadCurrentSite();
    void localStore.getAll().then((s) => {
      setWorkingLanguage(s.workingLanguage);
      void checkBackend(s.backendUrl, s.apiKey);
    });
  }, []);

  // Probe the backend's health endpoint so the popup can tell the user,
  // at a glance, whether requests will actually succeed. This is the
  // most common reason the extension "doesn't work": the backend the
  // extension points at isn't running or reachable.
  const checkBackend = async (url: string, apiKey: string): Promise<void> => {
    setBackend({ status: "checking", url });
    try {
      const res = await fetch(`${url}/api/v1/health`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: unknown;
      } | null;
      setBackend({
        status: res.ok && body?.ok === true ? "ok" : "down",
        url,
      });
    } catch {
      setBackend({ status: "down", url });
    }
  };

  const loadCurrentSite = async (): Promise<void> => {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.url || !tab.url.startsWith("http")) {
        setCurrentSite(null);
        return;
      }
      const hostname = new URL(tab.url).hostname;
      const res = await sendToBackground<CheckSiteAllowedResponse>({
        type: MESSAGE_TYPES.CHECK_SITE_ALLOWED,
        hostname,
      });
      setCurrentSite({ hostname, allowed: res.allowed, reason: res.reason });
    } catch {
      setCurrentSite(null);
    }
  };

  const toggleCurrentSite = async (
    direction: "allow" | "block",
  ): Promise<void> => {
    if (!currentSite) return;
    if (direction === "allow") {
      const allow = await localStore.getAllowlist();
      if (!allow.includes(currentSite.hostname)) {
        await localStore.setAllowlist([...allow, currentSite.hostname]);
      }
      const block = await localStore.getBlocklist();
      const next = block.filter((h) => h !== currentSite.hostname);
      if (next.length !== block.length) await localStore.setBlocklist(next);
    } else {
      const block = await localStore.getBlocklist();
      if (!block.includes(currentSite.hostname)) {
        await localStore.setBlocklist([...block, currentSite.hostname]);
      }
    }
    await loadCurrentSite();
  };

  const openOptions = (): void => {
    void chrome.runtime.openOptionsPage();
  };

  return (
    <div className="w-[340px] bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-violet-500 text-white">
            <SparkleIcon />
          </span>
          <div className="leading-tight">
            <div className="text-[13px] font-semibold tracking-tight">
              Inkwell
            </div>
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Translate, reply, and rewrite — in any language.
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={openOptions}
          aria-label="Open settings"
          title="Open settings"
          className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <GearIcon />
        </button>
      </header>

      <section className="px-4 py-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Inkwell works right away — no account, no sign-in. There are three
          ways to start; a ✨ button then opens the translate / reply /
          fix-grammar / rewrite popover.
        </p>
        <ul className="mt-2 space-y-1 text-[12px] text-zinc-600 dark:text-zinc-300">
          <li>
            <span className="font-medium text-zinc-800 dark:text-zinc-100">
              Select text
            </span>{" "}
            anywhere on a page — the result is copy-only, never written back.
          </li>
          <li>
            <span className="font-medium text-zinc-800 dark:text-zinc-100">
              Focus a text field
            </span>{" "}
            to draft a reply you can insert or copy.
          </li>
          <li>
            <span className="font-medium text-zinc-800 dark:text-zinc-100">
              Press{" "}
              <kbd className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[10px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {KBD_SHORTCUT}
              </kbd>
            </span>{" "}
            with nothing selected to type your own text and fix or rephrase it.
          </li>
        </ul>
      </section>

      <section className="flex items-center gap-2 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <span
          className={`inline-flex h-2 w-2 flex-shrink-0 rounded-full ${
            backend.status === "ok"
              ? "bg-emerald-500"
              : backend.status === "down"
                ? "bg-red-500"
                : "bg-amber-400"
          }`}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium">
            {backend.status === "ok" && "Backend connected"}
            {backend.status === "down" && "Backend unreachable"}
            {backend.status === "checking" && "Checking backend…"}
          </div>
          <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
            {backend.status === "down"
              ? "Inkwell can't translate or draft until this is fixed."
              : backend.url || " "}
          </div>
        </div>
        {backend.status === "down" && (
          <button
            type="button"
            onClick={openOptions}
            className="flex-shrink-0 rounded-md border border-zinc-200 px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Set up
          </button>
        )}
      </section>

      {currentSite && (
        <section className="border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex h-2 w-2 rounded-full ${
                currentSite.allowed ? "bg-emerald-500" : "bg-red-500"
              }`}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">
                {currentSite.hostname}
              </div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {currentSite.reason === "allowlist" && "Allowed (you opted in)"}
                {currentSite.reason === "blocklist" && "Blocked (you opted out)"}
                {currentSite.reason === "blocked-by-default" &&
                  "Blocked by default"}
                {currentSite.reason === "default" && "Allowed (default)"}
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                void toggleCurrentSite(currentSite.allowed ? "block" : "allow")
              }
              className="rounded-md border border-zinc-200 px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {currentSite.allowed ? "Disable here" : "Enable here"}
            </button>
          </div>
        </section>
      )}

      <section className="flex items-center justify-between border-t border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
          Working language:{" "}
          <span className="font-medium text-zinc-700 dark:text-zinc-200">
            {workingLanguage ? languageLabel(workingLanguage) : "…"}
          </span>
        </span>
        <button
          type="button"
          onClick={openOptions}
          className="text-[11px] text-indigo-600 hover:underline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-indigo-400"
        >
          Change
        </button>
      </section>

      <section className="border-t border-zinc-100 px-4 py-2.5 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        Nothing is auto-inserted or auto-sent. Settings are stored only on this
        device.
      </section>
    </div>
  );
}

function SparkleIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.94 14.5A2 2 0 0 0 8.5 13.06L2.37 11.48a.5.5 0 0 1 0-.96L8.5 8.94A2 2 0 0 0 9.94 7.5l1.58-6.13a.5.5 0 0 1 .96 0L14.06 7.5A2 2 0 0 0 15.5 8.94l6.13 1.58a.5.5 0 0 1 0 .96L15.5 13.06a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0Z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
    </svg>
  );
}

function GearIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
