# Bringing Multilingual Support Into the Agent's Workflow

**An engineering case study — how we built an integrated translation and
reply assistant as a Chrome extension, and the decisions behind it.**

|              |                                                        |
| ------------ | ------------------------------------------------------ |
| Audience     | Engineering, product, and support leadership           |
| Reading time | ~13 minutes                                            |
| Status       | Shipped — Inkwell 1.1.0                                 |
| Last updated | 2026-05-18                                              |

---

## 1. The problem hides in the tab bar

It is 2 PM. A support agent — we will call her Maria — opens the next
ticket in the queue. It is in French. Maria's French is rusty, so she
does what every agent does: she selects the text, opens a new tab, pastes
it into a public translation site, reads the English, and switches back.
She drafts a reply in English. She is not sure about a phrasing, so she
runs the draft through a separate grammar tool. The customer would prefer
French, so she pastes the corrected reply into the translator again and
copies the result back into the ticket.

Five tabs. Four context switches. Perhaps ninety seconds — and that is the
*fast* case, the one where nothing needed a second look.

Multiply that by a few hundred tickets a day across a dozen languages and
a pattern emerges. The translation itself is not the bottleneck; the
**workflow around it** is. Specifically:

- **Fragmented experience.** Agents jump between the support platform and
  several external tools to complete a single interaction.
- **No audit trail.** Translations done in a third-party tab are never
  captured. Reviewing a past conversation, or doing quality assurance on
  it, means reconstructing what was said from memory.
- **Inconsistent quality.** Replies drafted in English are not always
  polished, and there is no reliable step that renders them back into the
  customer's language.
- **Limited coverage.** As the customer base globalises, "just use
  Translate" scales badly: every new language adds more tab-hopping and
  more room for error.

None of these are translation-quality problems. Modern language models
translate well. They are **integration** problems — and integration
problems are solved by putting the capability where the work already
happens.

## 2. What "good" looks like

Before writing any code we wrote down what a solution had to do. Six
capabilities, each tied directly to one of the gaps above:

1. **Broad language coverage** out of the box, with automatic detection of
   the customer's language.
2. **Inline query translation** — translate an incoming message in one
   click, keeping both the original and the translation.
3. **Context-aware reply composition** — draft a reply and choose its
   language: the customer's, the agent's, or both.
4. **Grammar and rephrasing** that works in *any* supported language, not
   only English.
5. **A searchable history** of every translation and AI-assisted draft.
6. **Per-agent language preferences**, so the tool surfaces the languages
   each agent actually uses.

Two constraints sat above the feature list and never moved:

- **Excellent user experience.** Fast, unobtrusive, streaming responses;
  a preview before anything is inserted; nothing ever auto-sent.
- **Strong security.** The model provider's API key must never reach the
  browser. Untrusted customer text must never be able to hijack the
  model. Data retention must be minimal.

## 3. Why a Chrome extension

The support platform already exists. Agents already live in it all day.
The worst possible answer to "our workflow is fragmented" is "log into a
second platform."

A browser extension is the only delivery model that adds capability to a
screen **without owning that screen**:

- **Seamless integration.** It works on top of the existing support tool —
  no backend integration, no platform migration, no vendor coordination.
- **Better UX by construction.** The agent translates, rephrases, and
  composes in the same place the customer query is displayed.
- **Fast adoption.** A lightweight install, no change to existing tools.
- **Centralised history.** Because the extension sees every action, it can
  record every action — the audit trail the external-tab workflow could
  never produce.

The result is **Inkwell**: a Manifest V3 Chrome extension backed by a
small Next.js service. It works on Gmail, Outlook, LinkedIn, X, Slack,
WhatsApp Web, and any plain text field on the web.

## 4. Architecture at a glance

Three components, one of which we do not own:

```
┌──────────────────────┐   HTTPS + SSE (anonymous)   ┌───────────────────────┐
│  Chrome Extension    │ ──────────────────────────▶ │  Next.js backend       │
│  (Manifest V3)       │                             │  /api/v1/complete      │
│                      │ ◀──── streamed tokens ───── │  (CORS + IP limit)     │
│  • content script    │                             └───────────┬───────────┘
│    (Shadow-DOM UI)   │                                          │ server-to-server
│  • service worker    │                                          ▼
│    (network)         │                                  ┌───────────────┐
│  • popup / options   │                                  │   OpenAI API   │
│  settings + history  │                                  └───────────────┘
│  in chrome.storage   │
└──────────────────────┘
```

A few deliberate choices are visible already:

- **The model API key lives only on the server.** The extension never
  sees it; it only ever receives streamed tokens. Calls are
  server-to-server.
- **There is no account and no database.** The extension calls the
  backend anonymously. Every setting — and the entire translation
  history — lives in `chrome.storage.local` on the agent's own device.
- **A shared contract package** sits between the two halves. The request
  schema, the language catalog, the model catalog, and the message types
  are defined once, in TypeScript with runtime validation, and imported by
  both ends. The two halves cannot drift.

The extension itself has three parts. A **content script** renders all
in-page UI inside a closed Shadow DOM, so the host page's CSS and scripts
cannot reach it; per-site adapters know where to find the conversation on
Gmail, Outlook, LinkedIn, X, Slack, and WhatsApp Web. A **service worker**
is the only component that
makes network calls and consumes the streaming response. A **popup** and
**options page** hold quick status and settings.

## 5. The six capabilities, in practice

### 5.1 One language catalog, derived everywhere

Inkwell ships with fifteen languages: English, French, German, Spanish,
Italian, Portuguese, Dutch, Polish, Russian, Japanese, Chinese (Simplified
and Traditional), Korean, Arabic, and Hindi.

What matters is not the count but the **shape**. Every language is one
entry in a single catalog:

```ts
{ id: "fr", label: "French", nativeName: "Français" }
{ id: "ar", label: "Arabic", nativeName: "العربية", rtl: true }
```

That catalog is the single source of truth. The request schema validates
languages against it. The extension builds its language pickers from it.
The backend names languages from it. Adding the sixteenth language is a
**one-line change** — no schema edit, no UI edit, no prompt edit. The
business can prioritise languages as the customer base grows without a
re-architecture each time.

### 5.2 Inline query translation

When an agent opens Inkwell on a customer message, the extension detects
the language locally and labels it — "From · French" — before the agent
does anything. The agent picks **Translate**, chooses a target language
(their working language is the default), and gets a faithful translation
streamed into a preview. Both the original and the translation are written
to history.

Translation is treated as a **hard boundary**: the model is instructed to
*only* translate the text and never answer, summarise, or act on it. That
is partly a usability rule — an agent who asked for a translation does not
want a reply — and partly a security control, which §7 returns to.

### 5.3 Context-aware reply composition

The **Reply** action drafts a response from the conversation. Its key
addition is an output-language choice:

- **the customer's language** (the default — reply to a French customer
  in French),
- **the agent's working language**,
- **bilingual** — the reply written twice, in both languages,
- or **any other supported language**.

The agent who changes nothing still gets the right behaviour: replying to
a French customer produces a French reply, because "match the customer's
language" is the default.

### 5.4 Grammar and rephrasing, in any language

**Grammar** corrects spelling and phrasing; **Rewrite** adjusts tone,
length, and clarity, or composes from a brief. Both work in whatever
language the text is written in. Grammar in particular is constrained to
*never* translate — correcting a German draft must return German, not a
silent English translation. Rewrite, by contrast, *can* translate while it
restructures, when the agent asks it to.

### 5.5 Translation and action history

Every completed action — translation, reply, grammar fix, rewrite — is
recorded: the input text, the output, the languages, the action, the site,
and a timestamp. The options page exposes this as a **History** tab that is
searchable and filterable by action, language, and conversation, with a
one-click copy on any past result.

The history lives in `chrome.storage.local`, bounded to the most recent
250 entries. It never leaves the device. This is the audit trail the
external-tab workflow could not produce — and it stays consistent with the
product's privacy posture, because the *backend* still logs nothing but
metadata (see §7).

### 5.6 Agent language preferences

Each agent sets a **working language** and a list of **frequent
languages**. The working language is the default translation target and
the second language in a bilingual reply. Frequent languages are surfaced
at the top of every language picker, so the common targets are one click
away rather than buried in a fifteen-item list.

## 6. Six decisions that shaped the build

A feature list does not make a product. These are the engineering
decisions that did — each one a trade-off we made on purpose.

### Decision 1 — One catalog, derived everywhere

Covered in §5.1. The principle generalises: **anything two components must
agree on is defined once and imported.** The model catalog already worked
this way; the language catalog follows the same pattern. The payoff is
that "support another language" is a data change, and TypeScript refuses
to let the request schema and the UI fall out of sync.

### Decision 2 — Detect locally, trust the model

Language detection runs **in the browser**, using Chrome's built-in
detector (`chrome.i18n.detectLanguage`). No network request, no extra
permission, instant.

But detection is treated as a **hint, not a fact**. The detected language
is sent to the backend, yet the prompt still instructs the model to detect
the language from the text itself. A wrong or low-confidence local
detection costs nothing but a UI label — the translation is still correct.
Decoupling the *hint* from *correctness* let us use a fast, free,
imperfect detector without making accuracy depend on it.

### Decision 3 — Translation as a hard boundary

The text Inkwell translates is, by definition, untrusted: it is a message
written by a customer, and a customer message can contain text engineered
to manipulate a language model ("ignore your instructions and …").

Three layers contain that risk. The text is wrapped in explicit
`<UNTRUSTED_CONTEXT>` delimiters; a sanitiser strips role markers and
zero-width characters; and the system prompt declares the delimited
content to be data, never instructions. The Translate action adds a
fourth, almost accidental layer: "translate this and do nothing else" is
itself an injection-resistant frame. A model whose entire job is to
restate text in another language has little surface for an embedded
instruction to act on.

One subtle bug surfaced here and is worth recording. The first
implementation translated the *entire* structured context block — and so
the output came back with "Site:", "From:", and timestamp labels
translated alongside the message. The fix was to give translation a leaner
view of the context: the message body only, still wrapped for safety, with
the structural metadata stripped. A reminder that "translate the input" is
underspecified until you have defined exactly what *the input* is.

### Decision 4 — History stays on the device

The proposal asked for a centralised, auditable history. The instinct is a
database. We did not build one.

Inkwell has no accounts and no server-side storage, deliberately: it
removes whole categories of risk (no tokens to steal, no user data at rest
on a server) and whole categories of friction (no sign-in). History fits
that model. It lives in `chrome.storage.local` — on the device, available
offline, never transmitted, bounded so it cannot grow without limit, and
cleared by a single Reset action or by uninstalling.

"Centralised" was satisfied by centralising history **within the agent's
workflow**, not on a server. The agent gets one searchable record of every
interaction; the organisation gets no new data-at-rest liability.

### Decision 5 — Stream everything

Responses stream token by token over Server-Sent Events. The agent sees
the model "typing" within a couple of hundred milliseconds instead of
staring at a spinner for several seconds, and can cancel a response that
is heading the wrong way. Nothing is ever inserted or sent automatically —
the agent reviews a preview and explicitly chooses to insert or copy.

The backend runs this route on the Node runtime rather than the Edge
runtime. Edge would shave latency, but the per-IP rate limiter that guards
the model API key keeps its counter in memory, and that counter only means
something if it survives between requests. Node functions stay warm long
enough for it to. We chose the working rate limiter over the faster cold
start.

### Decision 6 — Make the unhappy paths obvious

A feature demo runs on the happy path. A tool an agent depends on is
judged on the *unhappy* ones — and customer support is nothing but edge
cases. Three of them shaped late, unglamorous work that mattered more
than any single feature.

**The backend might be unreachable.** The extension is useless if it
cannot reach its backend, and that failure used to surface as a raw
"Failed to fetch". Now the popup carries a backend-health indicator —
green "connected", red "unreachable" with a one-click route to settings —
so the most common "it isn't working" cause is visible before the agent
even tries. When a request does fail, the error names the backend and how
to fix it instead of leaking a stack-trace fragment.

**The clipboard is not guaranteed.** When Inkwell works on selected text
the result is copy-only — and `navigator.clipboard` is silently blocked
by the `Permissions-Policy` of some host pages (Medium among them). Copy
now falls back to a hidden-textarea `execCommand` path the host page
cannot veto, so "Copy" copies.

**Setup friction kills adoption.** A backend locked to an extension-ID
allowlist is correct for production but a wall in development — load the
extension, copy its generated ID, paste it into server config, restart.
So in development the backend accepts any `chrome-extension://` origin;
production keeps the strict allowlist. The extension works the moment it
is loaded.

None of this appears on a feature list. All of it is the difference
between a thing that demos and a thing an agent trusts.

## 7. Security and privacy, by construction

Because the system handles customer messages and a metered API key, the
posture was designed in, not added later.

- **The model API key never leaves the backend.** It lives in encrypted
  server environment variables. Calls are server-to-server. The extension
  only ever receives tokens.
- **The extension is minimal-permission.** A strict Content Security
  Policy with no remote code; a small set of permissions; no `<all_urls>`
  host access; all in-page UI inside a closed Shadow DOM. Sensitive sites —
  banking, healthcare, password managers — are blocked by default.
- **The backend is locked down.** In production, CORS admits only the
  configured extension origins; a per-IP rate limit blunts abuse of the
  anonymous endpoint; every request body is schema-validated and
  size-capped.
- **Prompt-injection defence** is layered, as §6 described: untrusted
  delimiters, a sanitiser, a system prompt that declares context to be
  data, and preview-before-insert as the final human check.
- **Data minimisation.** The backend logs only metadata — action, model,
  token counts, latency, and now the *language identifiers* of a request
  (useful for per-language quality metrics). It never logs the message
  text or the model's output. The only place message content is retained
  is the agent's own on-device history, which they control completely.

The net effect: the multilingual feature added real capability and **no
new server-side data-at-rest liability**.

## 8. A walkthrough: one French ticket, start to finish

Concretely, here is Maria's 2 PM ticket again — this time with Inkwell.

1. She opens the ticket. The French text is on screen. She presses
   `Cmd+Shift+K` (or clicks the Inkwell button that appears by the text field).
2. The popover opens. It already reads **"From · French"** — detected
   locally, before she has done anything.
3. She wants to read it first. She picks **Translate**, leaves the target
   on her working language (English), and presses generate. An English
   translation streams into the preview in about a second. She reads it.
   It is saved to history automatically.
4. She switches to **Reply**. The output language is already set to
   "Customer's language". She types a one-line instruction — *"apologise,
   offer a 10% credit"* — and generates. A French reply streams in,
   grounded in the conversation.
5. She reviews the preview, clicks **Insert**, and the French reply lands
   in the ticket's reply box. She reads it once more and sends it herself.

No new tabs. No copy-paste relay. One screen. And there is now a history
entry — original French, English translation, French reply — that a QA
reviewer or Maria herself can find later.

The before-and-after is not "translation became possible." It is
"translation stopped being a detour."

## 9. Measuring success

The feature ships with a measurement plan, not a victory lap. The metrics
that will tell us whether it worked:

| Metric | Why it matters |
| --- | --- |
| Average handling time on non-English tickets | The direct cost of the old tab-hopping workflow. |
| Agent adoption rate | A tool that is not used did not solve the problem. |
| Customer satisfaction by language | Catches quality regressions a single average would hide. |
| Per-language quality sampling | The backend logs language ids; QA can sample by language. |

The rollout plan is a pilot on the highest-volume non-English queues —
French and German first — before widening to the full language set.

## 10. What's next

- **More languages**, prioritised from the pilot's queue data — each one a
  single catalog entry.
- **More site adapters.** Gmail, Outlook, LinkedIn, X, Slack, and WhatsApp
  Web ship today; helpdesk platforms (Zendesk, Intercom, Freshdesk) are
  the next targets. The adapter layer is a registry, so each is an
  isolated addition — see
  [How-to: Add a site adapter](./how-to/add-a-site-adapter.md).
- **Per-conversation history in the popover**, so an agent can see prior
  exchanges on the same ticket without opening the options page.
- **Glossary support** — organisation-specific terms (product names,
  policy phrases) that should translate a fixed way every time.

## 11. Takeaways

For anyone building something similar, five things generalised beyond this
project:

1. **Integration beats capability.** The translation quality was never the
   problem. Removing the four context switches was the product.
2. **A single source of truth turns "scaling" into "data entry."** Because
   languages and models each live in one catalog, growth is a one-line
   change, and the type system guarantees nothing drifts.
3. **Separate the hint from the fact.** Local detection could be fast,
   free, and imperfect *because* correctness never depended on it.
4. **You can satisfy "centralised history" without a database.** Centralise
   it in the user's workflow, on their device. Capability went up; data-at-
   rest liability did not.
5. **The unhappy paths are the product.** Whether the backend is
   reachable, whether the host page allows a clipboard write, whether
   setup is finished — that is what an agent actually experiences. It
   never appears on a feature list, and it decides whether the tool is
   used at all.

The shape of the win is small and repeats every ticket: a capability that
used to live in five tabs now lives in one popover, with a record of every
use. That is what "integrated" actually means.

## Further reading

- [Multilingual support](./explanation/multilingual-support.md) — the
  design rationale in reference form.
- [Architecture](./reference/architecture.md) — component-by-component
  breakdown.
- [API reference](./reference/api.md) — the request/response contract,
  including the language fields.
- [Security](./security.md) and [Privacy](./privacy.md) — the
  full threat model and data-handling policy.
- [Prompt-injection defense](./explanation/prompt-injection-defense.md)
  — how untrusted content is contained.
- [CHANGELOG](../CHANGELOG.md) — the full release history.
