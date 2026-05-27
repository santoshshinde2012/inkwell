"""Tone presets exposed in the popover.

Two parallel maps: human-readable labels (used by the extension UI) and
prompt fragments (used by the prompt builder). Mirrors
`@inkwell/shared/tones`.
"""

from __future__ import annotations

from enum import StrEnum


class TonePreset(StrEnum):
    PROFESSIONAL = "professional"
    FRIENDLY = "friendly"
    CONCISE = "concise"
    DETAILED = "detailed"


TONE_PRESET_LABELS: dict[TonePreset, str] = {
    TonePreset.PROFESSIONAL: "Professional",
    TonePreset.FRIENDLY: "Friendly",
    TonePreset.CONCISE: "Concise",
    TonePreset.DETAILED: "Detailed",
}

# Server-side prompt fragments. Kept here so any client surface can preview
# them without re-implementing the wording.
TONE_PRESET_PROMPTS: dict[TonePreset, str] = {
    TonePreset.PROFESSIONAL: (
        "Use a polished, business-appropriate register. Avoid slang and "
        "contractions where natural, but never sound stiff."
    ),
    TonePreset.FRIENDLY: (
        "Use a warm, conversational tone. Light contractions and a "
        "personable register are encouraged."
    ),
    TonePreset.CONCISE: (
        "Be brief. Strip filler. Prefer short sentences. Get to the point on the first line."
    ),
    TonePreset.DETAILED: (
        "Provide a thorough response with relevant context, but stay on "
        "topic. Bullet lists are welcome when appropriate."
    ),
}
