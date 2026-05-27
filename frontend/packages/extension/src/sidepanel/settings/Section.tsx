// Shared section primitive + save-confirmation Toast.
//
// Every settings group renders as a `<Section>`: a rounded card with a
// muted icon tile, a title, an optional description, and an optional
// right-aligned meta slot (e.g. a count badge). All sections share the
// same neutral indigo-zinc accent so the page reads as a single
// palette rather than a per-section rainbow.

import type { JSX } from "react";
import type { LocalSettings } from "@inkwell/shared";
import { CheckIcon } from "../icons";

/** Patch signature passed into each section. */
export type Patch = (next: Partial<LocalSettings>) => void;
/** Flash a transient toast — the parent owns the timer. */
export type Flash = (msg: string) => void;

export interface SectionProps {
  settings: LocalSettings;
  patch: Patch;
  flash: Flash;
}

export function Section({
  title,
  description,
  icon,
  meta,
  children,
}: {
  title: string;
  description?: string;
  icon: React.ReactNode;
  /** Optional right-aligned slot next to the title (e.g. a count badge). */
  meta?: React.ReactNode;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3.5 transition-colors hover:border-zinc-700/80">
      <header className="mb-3 flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-zinc-800/80 text-zinc-300 ring-1 ring-inset ring-zinc-700/50"
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[12.5px] font-semibold tracking-tight text-zinc-100">{title}</h3>
            {meta}
          </div>
          {description && (
            <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">{description}</p>
          )}
        </div>
      </header>
      <div>{children}</div>
    </section>
  );
}

export function FieldLabel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      {children}
    </label>
  );
}

export function Toast({ message }: { message: string }): JSX.Element {
  return (
    <div
      role="status"
      className="pointer-events-none absolute inset-x-0 bottom-3 z-50 flex justify-center"
    >
      <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-zinc-100 px-3.5 py-1.5 text-[11px] font-medium text-zinc-900 shadow-lg shadow-black/40">
        <span className="text-emerald-600" aria-hidden="true">
          <CheckIcon size={12} />
        </span>
        {message}
      </div>
    </div>
  );
}

export function SkeletonStack(): JSX.Element {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading settings">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-24 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900/40"
        />
      ))}
    </div>
  );
}
