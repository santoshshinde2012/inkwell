// Profile card — display name + about-me.
//
// Both fields are personalization passed along on every /complete call.
// Empty values are dropped server-side, so the user can leave them blank.
//
// Save UX: one inline button per save. The previous version showed three
// concurrent confirmations (button label flip, inline "Saved" pill, AND
// the global toast). Now we keep just the global toast — single source
// of truth, less visual chatter.

import { useState } from "react";
import type { JSX } from "react";
import { localStore } from "../../lib/storage";
import { UserIcon } from "../icons";
import { FieldLabel, Section, type SectionProps } from "./Section";

const ABOUT_MAX = 2000;
const NAME_MAX = 120;

export function ProfileCard({ settings, patch, flash }: SectionProps): JSX.Element {
  const [displayName, setDisplayName] = useState(settings.displayName);
  const [aboutMe, setAboutMe] = useState(settings.aboutMe);
  const dirty = displayName !== settings.displayName || aboutMe !== settings.aboutMe;

  const save = async (): Promise<void> => {
    await localStore.setProfile(displayName, aboutMe);
    patch({ displayName, aboutMe });
    flash("Profile saved");
  };

  return (
    <Section
      title="Profile"
      description="Personalises replies — optional and stored on this device only."
      icon={<UserIcon size={13} />}
    >
      <div className="space-y-2.5">
        <FieldLabel label="Display name">
          <input
            type="text"
            value={displayName}
            maxLength={NAME_MAX}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Alex Rivera"
            className="block w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-[12.5px] text-zinc-100 placeholder-zinc-500 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
          />
        </FieldLabel>
        <FieldLabel label="About me">
          <textarea
            value={aboutMe}
            maxLength={ABOUT_MAX}
            rows={3}
            onChange={(e) => setAboutMe(e.target.value)}
            placeholder="e.g. I'm a PM. I prefer concise, friendly replies."
            // Cap the resize handle's reach so dragging can't push the
            // textarea past the section and overlap downstream cards.
            className="block max-h-48 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-[12.5px] text-zinc-100 placeholder-zinc-500 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
          />
          <span className="mt-1 block text-right text-[10px] text-zinc-500 tabular-nums">
            {aboutMe.length}/{ABOUT_MAX}
          </span>
        </FieldLabel>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty}
          className="inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-3.5 py-2 text-[12px] font-semibold text-white shadow-md shadow-indigo-950/30 transition-transform hover:-translate-y-px hover:from-indigo-400 hover:to-violet-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
        >
          Save profile
        </button>
      </div>
    </Section>
  );
}
