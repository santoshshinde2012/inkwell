"""Language catalog.

Mirrors `@inkwell/shared/languages`. English first; the rest follow the
rollout priority from the multilingual support proposal.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True, slots=True)
class LanguageInfo:
    """Catalog entry for a single language."""

    id: str
    """BCP-47 / ISO-639 identifier sent in API requests."""

    label: str
    """English name ("French")."""

    native_name: str
    """Endonym — the language's own name ("Français")."""

    rtl: bool = False
    """True for right-to-left scripts so the UI can set ``dir`` correctly."""


LANGUAGE_CATALOG: tuple[LanguageInfo, ...] = (
    LanguageInfo("en", "English", "English"),
    LanguageInfo("fr", "French", "Français"),
    LanguageInfo("de", "German", "Deutsch"),
    LanguageInfo("es", "Spanish", "Español"),
    LanguageInfo("it", "Italian", "Italiano"),
    LanguageInfo("pt", "Portuguese", "Português"),
    LanguageInfo("nl", "Dutch", "Nederlands"),
    LanguageInfo("pl", "Polish", "Polski"),
    LanguageInfo("ru", "Russian", "Русский"),
    LanguageInfo("ja", "Japanese", "日本語"),
    LanguageInfo("zh-Hans", "Chinese (Simplified)", "简体中文"),
    LanguageInfo("zh-Hant", "Chinese (Traditional)", "繁體中文"),
    LanguageInfo("ko", "Korean", "한국어"),
    LanguageInfo("ar", "Arabic", "العربية", rtl=True),
    LanguageInfo("hi", "Hindi", "हिन्दी"),
)

LANGUAGE_IDS: tuple[str, ...] = tuple(language.id for language in LANGUAGE_CATALOG)
"""Concrete language ids that appear as ``targetLanguage`` values."""

AUTO_DETECT: Literal["auto"] = "auto"
"""Sentinel sent as ``sourceLanguage`` to ask the model to detect the input language."""

SOURCE_LANGUAGE_IDS: tuple[str, ...] = (AUTO_DETECT, *LANGUAGE_IDS)
"""Valid ``sourceLanguage`` values — concrete catalog ids plus ``"auto"``."""

DEFAULT_WORKING_LANGUAGE: str = LANGUAGE_CATALOG[0].id


def get_language_info(language_id: str) -> LanguageInfo | None:
    return next((language for language in LANGUAGE_CATALOG if language.id == language_id), None)


def is_language_id(language_id: object) -> bool:
    return isinstance(language_id, str) and any(
        language.id == language_id for language in LANGUAGE_CATALOG
    )


def language_label(language_id: str) -> str:
    """English label for a known id; the raw id otherwise (never raises)."""
    info = get_language_info(language_id)
    return info.label if info is not None else language_id
