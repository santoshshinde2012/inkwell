// SitesTab — one tab of the options page.
//
// Composed by ./index.ts and routed to from options/App.tsx.

import { useState, type JSX } from "react";
import { DEFAULT_BLOCKED_HOSTS } from "@inkwell/shared";
import { localStore } from "../../lib/storage";
import { Card, type TabProps } from "../components";

export function SitesTab({ settings, patch, flash }: TabProps): JSX.Element {
  const updateAllow = async (next: string[]): Promise<void> => {
    await localStore.setAllowlist(next);
    patch({ siteAllowlist: next });
    flash("Allowlist saved");
  };
  const updateBlock = async (next: string[]): Promise<void> => {
    await localStore.setBlocklist(next);
    patch({ siteBlocklist: next });
    flash("Blocklist saved");
  };

  return (
    <>
      <HostListCard
        title="Allowlist"
        description="Hosts where the popover is always allowed (overrides default block)."
        list={settings.siteAllowlist}
        onChange={updateAllow}
        addPlaceholder="e.g. mail.google.com"
      />
      <HostListCard
        title="Blocklist"
        description="Hosts where the popover never appears, in addition to the defaults."
        list={settings.siteBlocklist}
        onChange={updateBlock}
        addPlaceholder="e.g. internal.company.com"
      />
      <Card
        title="Default blocklist"
        description={`These ${DEFAULT_BLOCKED_HOSTS.length} hosts are blocked out of the box. Add to the allowlist above to override.`}
      >
        <ul className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-xs text-zinc-600 dark:text-zinc-400">
          {DEFAULT_BLOCKED_HOSTS.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function HostListCard({
  title,
  description,
  list,
  onChange,
  addPlaceholder,
}: {
  title: string;
  description: string;
  list: string[];
  onChange: (next: string[]) => void | Promise<void>;
  addPlaceholder: string;
}): JSX.Element {
  const [entry, setEntry] = useState("");

  const add = (): void => {
    const v = entry.trim().toLowerCase();
    if (!v || list.includes(v)) return;
    void onChange([...list, v]);
    setEntry("");
  };

  return (
    <Card title={title} description={description}>
      <div className="flex gap-2">
        <input
          type="text"
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={addPlaceholder}
          className="flex-1 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-950 dark:placeholder-zinc-500"
        />
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          Add
        </button>
      </div>
      <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
        Use a bare hostname like{" "}
        <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">linkedin.com</code> — subdomains
        are matched automatically.
      </p>
      {list.length === 0 ? (
        <p className="mt-3 text-sm italic text-zinc-400 dark:text-zinc-500">No entries yet.</p>
      ) : (
        <ul className="mt-3 space-y-1">
          {list.map((h) => (
            <li
              key={h}
              className="flex items-center justify-between rounded-md border border-zinc-100 bg-zinc-50 px-3 py-1.5 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <span className="font-mono text-xs">{h}</span>
              <button
                type="button"
                onClick={() => void onChange(list.filter((x) => x !== h))}
                aria-label={`Remove ${h}`}
                className="text-xs text-zinc-500 hover:text-red-600 dark:hover:text-red-400"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Languages tab — agent language preferences
// -----------------------------------------------------------------------------
