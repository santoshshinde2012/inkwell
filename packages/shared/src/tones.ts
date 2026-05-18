// Tone presets shown in the popover. Users can also supply a freeform
// instruction that supersedes the preset.

export const TONE_PRESETS = [
  "professional",
  "friendly",
  "concise",
  "detailed",
] as const;
export type TonePreset = (typeof TONE_PRESETS)[number];

export const TONE_PRESET_LABELS: Record<TonePreset, string> = {
  professional: "Professional",
  friendly: "Friendly",
  concise: "Concise",
  detailed: "Detailed",
};

// Server-side prompt fragments. Kept here so the extension can preview them
// in the options page without re-implementing the wording.
export const TONE_PRESET_PROMPTS: Record<TonePreset, string> = {
  professional:
    "Use a polished, business-appropriate register. Avoid slang and contractions where natural, but never sound stiff.",
  friendly:
    "Use a warm, conversational tone. Light contractions and a personable register are encouraged.",
  concise:
    "Be brief. Strip filler. Prefer short sentences. Get to the point on the first line.",
  detailed:
    "Provide a thorough response with relevant context, but stay on topic. Bullet lists are welcome when appropriate.",
};
