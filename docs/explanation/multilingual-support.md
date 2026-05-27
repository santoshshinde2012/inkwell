# Explanation: Multilingual support

_Why Inkwell handles languages the way it does._

Inkwell was extended to let support agents work with customer queries in
many languages without leaving the page. This note explains the design —
what each piece does and why it sits where it does.

## The problem

Agents supporting customers across regions reach for an external tool
(Google Translate, a separate tab) to read a query, then draft a reply in
English, then sometimes translate it back. That workflow is fragmented,
leaves no audit trail, and produces uneven reply quality. Inkwell folds
the whole loop into the popover the agent already uses.

## The four capabilities

| Capability | Where it lives |
| --- | --- |
| Translate an incoming query | `translate` action + `TranslateStrategy` |
| Reply in the customer's language / yours / both | `reply` action + `targetLanguage` / `bilingual` |
| Fix grammar in any language | `grammar` action — stays in the source language |
| Searchable history of everything | `extension/src/lib/history.ts` + options "History" tab |

## One catalog, derived everywhere

[`shared/src/languages.ts`](../../frontend/packages/shared/src/languages.ts) holds
`LANGUAGE_CATALOG` — id, English label, endonym, RTL flag — for 15
languages. It is the single source of truth:

- the request schema validates `sourceLanguage` / `targetLanguage`
  against it (`z.enum`),
- the popover and options page build their language pickers from it,
- the prompt builder names languages from it.

Adding a language is a one-line catalog edit. Nothing else changes —
the same pattern the [model catalog](./model-providers.md) uses.

## Detection is local, the model is authoritative

The extension detects the source language with
`chrome.i18n.detectLanguage` ([`extension/src/lib/languages.ts`](../../frontend/packages/extension/src/lib/languages.ts)).
This runs against Chrome's bundled CLD model: no network call, no extra
permission, instant. The result is used to label the popover ("From ·
French") and to tag history entries.

That detection is **only a hint**. It is sent to the backend as
`sourceLanguage`, but the prompt always instructs the model to detect the
language from the text itself. So a wrong or low-confidence local
detection (it returns `"auto"` then) costs nothing but a UI label — the
translation is still correct. Detection and correctness are deliberately
decoupled.

## Translation is a hard boundary

`_TranslateStrategy` ([`services/prompt.py`](../../backend/src/inkwell_backend/services/prompt.py))
tells the model to translate faithfully and to **never answer, summarize,
or act on** the content. That is a usability requirement — you want a
translation, not a reply — and it doubles as prompt-injection defense:
the text being translated is exactly the untrusted customer content, and
"only translate this" is a strong, simple frame. The text still goes
through the same `<UNTRUSTED_CONTEXT>` delimiters and
[sanitizer](./prompt-injection-defense.md) as every other action.

## Reply language modes

For `reply` (and `rewrite`), the output language is driven by two
request fields:

- `targetLanguage` omitted → match the source language (reply to a French
  customer in French — the default),
- `targetLanguage` set → write the whole reply in that language,
- `bilingual: true` → write the reply twice, source language then
  `targetLanguage` (the agent's working language), separated by `---`.

`grammar` ignores both: correcting grammar must never silently translate,
so it always stays in the text's own language.

## History stays on the device

Every completed action is written to
[`extension/src/lib/history.ts`](../../frontend/packages/extension/src/lib/history.ts) —
input, output, languages, action, site, timestamp. It lives in
`chrome.storage.local`, exactly like every other Inkwell setting: never
sent to a server, available offline, wiped by the options "Reset" button.
The log is bounded (250 entries, oldest dropped; each text field clipped)
so it cannot grow without limit. The options "History" tab makes it
searchable and filterable by action, language, and conversation.

This keeps the [privacy posture](../privacy.md) intact — the backend
still logs only metadata and never prompt content — while giving agents
the auditable record the workflow needs.

## Agent preferences

The options "Languages" tab stores a **working language** (the default
translate target and the second language in a bilingual reply) and a list
of **frequent languages** (surfaced first in the popover pickers). Both
live in `chrome.storage.local` alongside the other settings.

## See also

- [Architecture](../reference/architecture.md)
- [API](../reference/api.md)
- [Model providers](./model-providers.md)
- [Prompt-injection defense](./prompt-injection-defense.md)
- [Privacy](../privacy.md)
