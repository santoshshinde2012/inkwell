# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses semantic versioning.

## [Unreleased]

### Added

- **`/api/v1/ocr` content-negotiates streaming.** Clients sending
  `Accept: text/event-stream` get an SSE byte stream of `token` /
  `error` / `done` frames (with `: keep-alive` heartbeats every 15 s);
  the default `Accept: application/json` path returns the one-shot
  `{ text, model }` body unchanged. The provider Protocol gains
  [`stream_recognize_text(args)`](backend/src/inkwell_backend/providers/base.py),
  the OpenAI provider uses `stream=True` on the vision call with the
  same prompt shape as the non-streaming path, and the mock provider
  emits the placeholder in three chunks for realistic local-dev UX.
  The side panel opts in via a new `onPartial` callback in
  [`lib/ocr.ts`](frontend/packages/extension/src/lib/ocr.ts), which
  surfaces the running text to the textarea as the model produces it
  — for dense screenshots that removes seconds of perceived latency.
  The right-click context-menu flow stays on JSON (it opens the
  popover once on success), so no UX regression there.
- **OCR pre-upload preprocessing pipeline.** Side-panel paste / drop /
  file-picker images now decode → EXIF-rotate → downscale to
  ≤ 2560 px on the longest edge → re-encode as JPEG @ 0.92 before
  upload. Phone photos come out the right way up without us shipping
  an EXIF parser; 4K screenshots that previously rejected at the 8 MB
  cap now round-trip as ~500 KB; HEIC / AVIF (and anything else
  Chrome can decode via `createImageBitmap`) is normalised to a
  backend-accepted MIME type. The raw-input cap moved to
  [`MAX_OCR_INPUT_BYTES`](frontend/packages/shared/src/constants.ts)
  (32 MB) so users almost never hit it again.
- **Structure-preserving OCR prompt.** Rewrote
  [`OCR_SYSTEM_PROMPT`](backend/src/inkwell_backend/domain/prompts.py)
  to keep the document's visual structure: tables as GitHub pipe
  tables, code / shell output in fenced blocks (with original
  indentation), bulleted and numbered lists, Markdown headings when
  the hierarchy is clear, math as LaTeX, source-script preservation,
  and an explicit multi-column reading-order rule. No content paraphrasing.
- **Process-local OCR result cache.** A 256-entry, 24-hour TTL+LRU
  cache keyed by `sha256(model || canonical_base64)` short-circuits
  repeat OCR of the same image — right-clicking the same screenshot
  twice now returns instantly without re-billing the upstream. The
  cache module lives in
  [`services/ocr_cache.py`](backend/src/inkwell_backend/services/ocr_cache.py),
  is consulted by both the JSON and SSE paths, and writes through
  on the streaming path's clean finish.
- **OCR audit logging.**
  [`OcrLogEvent`](backend/src/inkwell_backend/services/audit.py) joins
  `CompletionLogEvent` with the same metadata-only discipline:
  `model`, `request_bytes`, `duration_ms`, `status`, `response_chars`,
  `cache_hit`, `streamed`, `error_code`, `client_request_id`,
  `via_portkey`. Both the JSON path and the streaming generator's
  `finally` block emit exactly one event per terminal outcome — success,
  cache hit, abort, validation failure, rate limit, or upstream error
  — so operators can slice OCR latency / cache hit rate / error rate
  the same way they slice completions.
- **Context-aware default action.** When fresh text arrives in the
  side panel (capture selection, OCR finish, popover handoff) or in
  the in-page popover (mount with a field or selection), the action
  picker auto-selects based on the text's surface and language:
  non-English → **translate**; English from a textarea /
  contenteditable → **grammar**; English from page text or OCR → **reply**.
  Language detection prefers Chrome's bundled CLD via
  `chrome.i18n.detectLanguage` (run in parallel with the popover's
  storage round-trips, so first paint already has the right answer)
  and falls back to a Latin-script heuristic for short / low-confidence
  text. New helpers live in
  [`lib/default-action.ts`](frontend/packages/extension/src/lib/default-action.ts);
  `GET_SELECTION` now carries the source kind so the side panel knows
  whether the selection came from a draft or from page content.
- **Portkey AI gateway integration (optional, transport-level toggle).**
  Setting `USE_PORTKEY=true` (with `PORTKEY_API_KEY` set) routes every
  upstream LLM call — `/api/v1/complete` chat completions *and*
  `/api/v1/ocr` vision recognition — through the Portkey gateway,
  unlocking observability, caching, retries, fallbacks, and centralised
  secret management. Default behaviour is unchanged when the toggle is
  off. The integration is concentrated in
  [`backend/src/inkwell_backend/providers/portkey.py`](backend/src/inkwell_backend/providers/portkey.py)
  + the existing OpenAI client factory; service code, route handlers, the
  provider Protocol, and tests are untouched. Optional virtual-key mode
  (`PORTKEY_VIRTUAL_KEY`) lets the Portkey vault provide the upstream
  credential so `OPENAI_API_KEY` can be left blank in production.
  Misconfiguration (`USE_PORTKEY=true` without `PORTKEY_API_KEY`) fails
  loud at startup via a Pydantic cross-field validator.
- **End-to-end distributed tracing through the gateway.** The extension's
  `X-Client-Request-Id` UUID now flows through the completion and OCR
  pipelines into the provider layer as
  [`ProviderCompletionArgs.trace_id`](backend/src/inkwell_backend/providers/base.py)
  / `VisionArgs.trace_id`; when Portkey is enabled, the OpenAI SDK
  receives a per-call `extra_headers={"x-portkey-trace-id": <uuid>}`. One
  id now correlates the popover, SSE stream, our audit log line, and
  Portkey's gateway log — operators can pull up an entire request in a
  single search across either system.
- **Audit log gains a `via_portkey` dimension.**
  [`CompletionLogEvent`](backend/src/inkwell_backend/services/audit.py)
  carries `via_portkey: bool | None`, populated as the gateway-enabled
  flag whenever a real upstream was hit (left `null` on the mock path so
  it can't be misread as "direct"). Lets operators slice latency and
  error metrics by transport path.
- **Vendor-neutral default model setting.** Renamed `OPENAI_DEFAULT_MODEL`
  → `DEFAULT_MODEL` (the catalog in `domain/models.py` resolves the id
  to the right provider). The old env var is still accepted via Pydantic
  `AliasChoices`, so existing `.env` files keep working.
- **Single end-to-end OpenAI wrapper.** `providers/openai_provider.py`
  now owns *both* chat completions and OCR vision — the OCR pipeline
  used to bypass the provider abstraction and call the OpenAI SDK
  directly. `services/ocr.py` now goes through
  `provider.recognize_text(VisionArgs)` like every other call, so
  swapping vendors is one new file in `providers/`. OCR prompts moved
  to [`domain/prompts.py`](backend/src/inkwell_backend/domain/prompts.py),
  and the `CompletionProvider` Protocol gained `recognize_text()` and
  `aclose()` methods. The lifespan hook in `main.py` now calls
  `aclose_all_providers()` instead of reaching into `openai_client`
  directly.
- **Backend operational endpoints.** `GET /api/v1/live` (process-alive
  probe), `GET /api/v1/ready` (readiness gate — 503 until lifespan
  startup completes), `GET /api/v1/version` (build version + boot
  timestamp), `GET /api/v1/models` (the model catalog the backend
  recognises). The new endpoints live in
  [`api/v1/health.py`](backend/src/inkwell_backend/api/v1/health.py) and
  [`api/v1/meta.py`](backend/src/inkwell_backend/api/v1/meta.py); the
  lifespan hook in `main.py` flips the ready flag on startup and drains
  it on shutdown so rolling deploys see the 503 → 200 transition before
  traffic lands.
- **SSE heartbeats on `/api/v1/complete`.** During long generations the
  backend emits a `: keep-alive\n\n` comment frame every 15 s of model
  silence so idle reverse proxies (nginx, Cloudflare, load balancers)
  don't reap the connection mid-stream. Comment lines are part of the
  SSE spec and are silently dropped by every conforming parser,
  including the extension's.
- **`X-Client-Request-Id` end-to-end correlation.** The extension's SSE
  client sends a UUID per request; the backend reads it via a new
  FastAPI dependency, propagates it through the completion pipeline,
  and includes it in the structured audit log line so a single
  generation can be traced across the popover, the background service
  worker, the SSE stream, and the audit drain.
- **`Retry-After` on 429.** Rate-limit responses carry an RFC 9110
  `Retry-After` header (seconds) and an `error.details.retryAfterMs`
  field (delta-from-now in ms), so clients know exactly when to retry.
- **In-page popover selections inside contenteditables.** Medium /
  Substack / Notion-style editors are large contenteditables; the
  trigger used to anchor to the *whole editor* (far from the
  user's selection) because selections inside contenteditables were
  filtered out as "field-mode territory." Now the trigger anchors to
  the highlight rect, and the field trigger is restored if the user
  clears the selection while still focused in the editor.
- **`makeUuid()` fallback for HTTP pages.** `crypto.randomUUID()` is
  gated to secure contexts; on plain HTTP host pages the in-page
  popover's content script would silently throw and the Generate
  button appeared dead. The new helper falls back to
  `crypto.getRandomValues()` (RFC 4122 v4 layout) and finally
  `Math.random()`, so streamId generation works regardless of context.
- **`runStart()` error surfacing in the popover.** Wraps `start()` in a
  catch that flips `state.error` and re-renders, so a future unexpected
  rejection never appears as a dead button again.

### Changed

- **Side Panel UI/UX — slim per-view TopBars + History filter chips +
  hover-Copy.** The mobile-app drawer model is now joined by a slim
  single-line TopBar on every view (Assistant / History / Settings):
  hamburger · brand mark · view title · live status indicator (green
  dot when backend is online, red on offline, amber while probing). The
  History view gained per-action **filter chips** (All / Reply /
  Translate / Grammar / Rewrite with live counts, color-coded), a
  **sticky search field**, **sticky day headers**, and an **inline
  Copy button on every row** so the most common action (copy the
  output) no longer requires expanding the row first. The Settings
  view was reorganised into a directory ([`sidepanel/settings/`](frontend/packages/extension/src/sidepanel/settings/))
  with one file per section, a single muted accent palette across all
  cards (no more rainbow), and a single save-confirmation Toast (the
  old "Up to date ✓ + Saved pill + Toast" triple-confirmation was
  redundant).
- **Backend security and reliability hardening.**
  - **Origin required on writes.** GET requests may omit `Origin`
    (server-to-server diagnostics) but every POST is now rejected with
    `ORIGIN_NOT_ALLOWED` if the header is missing. Closes the "any
    non-browser script can replay `/complete` anonymously and spend
    tokens" hole.
  - **`Access-Control-Allow-Credentials` removed.** Inkwell has no
    auth and no cookies; reflecting `Origin` with credentials is the
    canonical XSRF pattern and is unnecessary here.
  - **Origin comparison case-normalised** (lower-case + strip trailing
    slash) so `APP_URL=http://Localhost:8000/` no longer mismatches
    the browser's `http://localhost:8000`.
  - **Shared `AsyncOpenAI` client with explicit timeouts.** Was
    constructing a fresh client (and TLS handshake) per request with
    the SDK's 600 s default; a hung upstream would tie up a worker for
    ten minutes. New `providers/openai_client.py` exposes a process-
    wide singleton with `httpx.Timeout(connect=5, read=60, write=10,
    pool=5)`, closed on graceful shutdown.
  - **Body-size header pre-check on `/complete`.** Mirrors `/ocr`;
    rejects a 50 MB body with 413 before reading it into memory.
  - **Pipelines wrapped in `try/except`** so an unexpected pre-flight
    error returns a clean `ApiError` with CORS headers attached
    instead of a bare 500.
  - **Rate limiter switched to `deque`-backed sliding window** (O(stale)
    per call instead of two O(window) list comprehensions; semantics
    unchanged).
  - **`assert_never` on the `ErrorCode → HTTP status` mapping** —
    adding a new `ErrorCode` without a status now fails at type-check
    time, not at runtime via the silent `500` fallback.
  - **Default host flipped to `127.0.0.1`** in `python -m
    inkwell_backend`; container deployments still bind `0.0.0.0` via
    the Dockerfile `CMD`.
- **`.dockerignore` fix.** The previous `*.md` line excluded
  `README.md`, which the Dockerfile `COPY pyproject.toml README.md ./`
  needs for the wheel's metadata — the build was broken in a way that
  only surfaced on fresh checkouts. Switched to `**/*.md` + an
  explicit `!README.md` allow-list line.

### Removed

- **`docs/medium-article.md`.** 698-line aspirational essay describing
  tooling (Portkey/Datadog/LangGraph/Guardrails) that Inkwell doesn't
  actually have. Overlapped thematically with the canonical
  [`docs/production-blueprint.md`](docs/production-blueprint.md), was
  not linked from the docs index, and confused readers walking the
  docs tree.

---

## [Drawer-pattern iteration — pre-Unreleased]

The mobile-app drawer pattern below was the *previous* Side Panel
shape; superseded by the slim per-view TopBars described above. Kept
here so a future archaeologist can reconstruct the intermediate state
from the CHANGELOG instead of trawling commits.

### Changed

- **Side Panel UI/UX refactor — mobile-app pattern.** The persistent
  left navigation rail has been replaced with a hamburger-triggered
  overlay drawer (slides in from the left over a dimmed/blurred
  backdrop; Esc/backdrop/nav-pick all dismiss). The drawer carries a
  compact profile card (gradient avatar + display name + one-line
  backend status), three nav items (Assistant, History, Settings) with
  a live History badge count, a brand-gradient "Open advanced settings"
  CTA, and a compact one-line footer. The Assistant view now opens with
  a hero empty state (action-themed icon + title + description + status
  pills), keeps the segmented action picker visible in its own band,
  and ends in a chat-input-style bar: chip toolbar (current mode +
  Options + Selection) above an auto-growing textarea with a `+`
  capture button on the left and a circular send button on the right.
  Per-request Options moved out of the inline disclosure into a
  bottom-sheet modal with focus trap, Escape, body scroll lock. Each of
  the four actions has its own color theme (indigo / sky / emerald /
  amber) that flows through the active tab, result-card glow, thinking
  dots, streaming caret, and primary CTA gradient. The History view
  gained day-grouping, search, inline copy/delete and clear-all; it
  auto-refreshes via `chrome.storage.onChanged` so entries written from
  the popover on another tab appear without a reload. The Settings view
  was rebuilt with per-section colored icon glyphs (User/Palette/Cpu/
  Globe/Sliders), a refined Profile card with a flash "Saved ✓"
  indicator, model cards with semantic tier badges (`FAST` amber /
  `QUALITY` emerald) and a check-circle in place of the radio dot, and
  a Languages search filter. The whole shell is wrapped in an
  ErrorBoundary so a render throw can be recovered without reloading.
  `Cmd/Ctrl+B` toggles the drawer. The last-viewed tab is restored on
  next open.
- **Options page aligned with the Side Panel.** Tailwind switched to
  `darkMode: "class"`; `<html class="dark">` forces dark on the options
  page so the existing `dark:` variants activate regardless of system
  theme. The Header, Tabs (pill segmented control with active
  gradient), Card primitive (rounded-2xl), and Toast (centered pill)
  were refreshed to share the Side Panel's design language.

### Removed

- **Toolbar popup (`src/popup/`).** Superseded by the Side Panel —
  clicking the toolbar icon opens the side panel directly. The popup
  React app, its `index.html`, and its `main.tsx` were deleted.
- **Unit test infrastructure.** All `*.test.ts` files, `vitest.config.ts`,
  the `vitest` devDependency, the `test`/`test:watch` scripts in the
  root `package.json`, and the **Test** step in CI were removed.
  Quality gates are now **typecheck → lint → build**. Validation of UI
  behavior is done by hand against the side panel and popover.
- **`docs/ARTICLE.md` and `docs/PROJECT_BRIEF.md`.** The marketing case
  study (460 lines of narrative about how multilingual support shipped
  at 1.1.0) and the original Claude Code scaffolding brief (356 lines
  of historical "where we started" plan) were deleted. Both predated
  the Side Panel refactor and only served as snapshots in time;
  current technical state lives in [`docs/reference/architecture.md`](docs/reference/architecture.md)
  and the [CHANGELOG](#changelog). References to them were removed
  from `docs/README.md`.

### Added

- **Chrome Side Panel — the assistant is now persistent.** Clicking the
  toolbar icon docks Inkwell as a Chrome Side Panel on the right of the
  window (via the `sidePanel` permission and `chrome.sidePanel.setPanelBehavior`
  with `openPanelOnActionClick: true`). The user can keep the assistant
  open while browsing — Reply, Translate, Grammar, Rewrite, streaming
  preview, and Copy all live there, with the same Options disclosure and
  the same persisted settings (`ui.lastUsed`, `ui.optionsExpanded`) as
  the in-page popover, so both surfaces open in sync. A "Use page
  selection" button pulls the active tab's current highlight into the
  source box via a new `GET_SELECTION` message handler in the content
  script. The background's stream router now serves both callers: tokens
  flow to a tab via `chrome.tabs.sendMessage` for the popover (a content
  script), or via `chrome.runtime.sendMessage` for the side panel (an
  extension page with no tab id). The previous toolbar popup is replaced
  by the side panel.
- **Left navigation rail and inline Settings inside the Side Panel.** The
  side panel is now a two-view app — Assistant and Settings — switchable
  from a left nav rail that's always visible. The rail carries the
  Inkwell brand mark with a small backend-status dot, an *Assistant*
  button, a *Settings* button, and an *Open full settings* link at the
  bottom that jumps to the options page for advanced config (Backend,
  Sites, History, Reset). The inline Settings view covers the everyday
  preferences — Profile (display name, about me), Default tone, Default
  model, Working language, Frequent languages — each saving on change
  with a confirmation toast, so the user never has to leave the side
  panel for typical adjustments. Both views stay mounted (toggled via
  `hidden`) so typed text and in-flight streams survive a navigation
  hop. The action tabs switched to icon-only with the action name shown
  in bold at the start of the hint line, fixing the *"Trans…", "Gram…",
  "Rewr…"* truncation seen at narrow side-panel widths. The preview
  area now stretches to fill the empty vertical space instead of
  leaving a void above the Generate button.
- **Brand identity — logo and extension icons.** Inkwell now has a real
  brand mark: a white ink drop on the indigo→violet gradient (the drop is
  the ink, the rounded tile is the well). Added the master
  `icons/logo.svg` and the PNG icon set (16/32/48/128) the manifest
  references — the extension previously shipped **no icons at all**, so
  Chrome displayed a generic placeholder and it could not be published to
  the Chrome Web Store. The in-app marks (popover header, popup, options
  page, and the in-page trigger) were rebranded from a generic sparkle to
  the ink drop. `packages/extension/scripts/generate-icons.sh` regenerates
  the PNGs from the SVG master.
- **Automated test suite and full linting.** Added a Vitest unit suite
  (52 tests) over the pure logic — `@inkwell/shared` (language and model
  catalogs, the request schema's per-action rules, error helpers) and the
  backend `lib/` (sanitiser, prompt builder, rate limiter). Added ESLint
  flat configs for the `shared` and `extension` packages (the backend
  already used `next lint`). `pnpm test` and `pnpm lint` now cover the
  whole monorepo, and CI gates every PR on typecheck + lint + test +
  build.

### Changed

- **Docs reorganised — all documentation now lives under `docs/`.**
  `ARTICLE.md` and `PROJECT_BRIEF.md` moved from the repository root into
  `docs/`, joining the rest of the Diátaxis tree. The top-level
  `README.md` and the `docs/` index now link to their new locations, and
  every cross-reference was updated.
- **Popover deep polish.** Slim, branded scrollbars on every scrollable
  region; brand-tinted text selection and caret colour in the inputs; an
  animated three-dot indicator replaces the static "Thinking…" text while
  the first tokens are in flight. The font stack now leads with
  `system-ui`, with subpixel-antialiased rendering for crisp glyphs. Dark
  mode and `prefers-reduced-motion` variants for every new style.
- **Popup and Options polish.** Smooth `transition-colors` on hover and
  consistent keyboard `focus-visible` rings across the popup's buttons.
  The Options tab bar is now sticky with a `backdrop-blur` background, so
  navigation stays reachable while scrolling long sections like History.
- **Options disclosure — focus the popover on the use case.** Language,
  tone, model, and the optional instruction now collapse into a single
  `Options · …` disclosure above the preview, with an inline summary of
  the current settings so the user can verify them at a glance without
  expanding. Collapsed by default so the popover's primary surface is
  just text in → result out; the expanded/collapsed state persists in
  `chrome.storage.local` per device. Auto-expands when a Rewrite would
  fail because its only input (the instruction) lives in the now-hidden
  section. The disclosure is a single bordered card — the toggle is its
  borderless header with a sliders icon + inline summary + chevron;
  the body slides open inside the same frame, separated by a hairline
  divider when expanded. Smooth content-aware expand animation via the
  `grid-template-rows: 0fr → 1fr` trick — no hard-coded max-height —
  and respects `prefers-reduced-motion`. Rewrite's "describe below"
  error messages and placeholder were updated to point at Options.
- **Last-used settings persist across popover opens.** Action, tone,
  model, source language, and target-language choice are now saved to
  `chrome.storage.local` (key `ui.lastUsed`) the moment they change.
  Next time the popover mounts, every control opens to the value the
  user last picked — no more resetting to "Reply · auto · workingLanguage"
  every session. Every persisted field is validated against the live
  catalogue on load (tones, models, language ids), so a schema change
  that retires a value silently falls back to the configured default
  instead of breaking. Instruction is deliberately *not* persisted —
  it's per-request guidance, not a sticky setting. As part of the same
  refactor, all popover boot-time settings (working language, frequent
  languages, default tone/model) now load in a single parallel
  `Promise.all` before the first paint, eliminating the brief post-paint
  flicker the old "apply defaults after first paint" path could cause.
  The persistence helpers and validators were extracted to
  `lib/ui-state.ts` so the popover and the new Side Panel share one
  source of truth.
- **Options page polish.** Refined Card component (larger title, more
  breathing room, `rounded-2xl`, subtle hover-border lift), primary
  buttons now use the indigo accent with a proper focus ring, the tone
  preset chips switched from heavy black/white pills to indigo-on-white
  active state matching the model picker, and the save Toast picked up
  a green check icon and tighter spacing.

### Fixed

- **Popover dismissed itself on every internal click — Generate included.**
  The outside-click handler tested `composedPath().includes(root)` to
  detect clicks inside the popover, but the popover lives in a *closed*
  shadow root. `composedPath()` from a document-level listener never
  exposes the shadow's internal nodes, only the host element, so the
  check was always false and every `mousedown` inside the popover tore it
  down before the click could land. The handler now matches the shadow
  host (and the retargeted `event.target` as a fallback).
- **Form controls rendered in monospace.** Six rules in the popover used
  `font: <size> inherit` — invalid CSS, because `inherit` is not a valid
  component of the `font` shorthand, so the whole declaration was dropped.
  `<textarea>`, `<select>`, and `<button>` then fell back to the UA's
  default font, which is monospace for textareas. Replaced every invalid
  shorthand with longhand declarations driven by a single `--inkwell-font`
  variable.
- **Scrolling the page destroyed an open popover in selection mode.** The
  trigger and popover share a closed shadow host. Once the popover
  opened, the trigger's "dismiss on scroll/resize" handler kept firing
  and called `removeTrigger()`, which removed the host out from under the
  open popover (and leaked its listeners since `teardown` never ran). The
  trigger now stands down once the popover is open — the popover owns its
  own dismissal (Esc / outside-click).
- **Misleading comment claimed focus was trapped in the popover.** The
  popover is `aria-modal="false"` and does not — and should not — trap
  focus. The header comment now describes the actual focus behaviour
  (initial focus on the primary input, focus restored on successful
  insert, Esc / Cmd-Enter shortcuts).

## [1.1.0] — 2026-05-18

### Fixed

- **Clipboard copy now works on restrictive pages.** "Copy" used only
  `navigator.clipboard`, which the host page's `Permissions-Policy` can
  block outright (Medium, among others), so the result silently failed to
  copy. Copy now uses an `execCommand`-based path that is not gated by the
  page's policy, with `navigator.clipboard` as a fallback.
- **Actionable backend errors.** A failed request used to surface the raw
  "Failed to fetch". It now names the backend URL and how to fix it; an
  origin rejection now tells the user the exact `chrome-extension://…`
  value to add to `ALLOWED_EXTENSION_IDS`.
- **Clear field-mode guidance.** Focusing a text field on a site with no
  conversation context (a helpdesk with no adapter) and choosing Reply
  used to fail with a generic schema error. The popover now explains what
  to do — select the customer's message, then click the Inkwell icon.
- **`next.config.js` named the pre-rename package.** `transpilePackages`
  still referenced `@aiwa/shared`; corrected to `@inkwell/shared`.
- **`.gitignore` excluded all documentation.** A `*.md` ignore rule kept
  only `README.md` files — `ARTICLE.md`, `CHANGELOG.md`, and every
  `docs/*.md` would have been left out of version control. The rule was
  removed.

### Added

- **Backend connectivity indicator in the popup.** The popup probes
  `/api/v1/health` and shows "Backend connected / unreachable", with a
  shortcut to the options page — so the most common "it isn't working"
  cause is visible at a glance.
- **Outlook, Slack, and WhatsApp Web site adapters.** Context extraction
  now covers all six platforms the manifest grants host permission for
  (Gmail, Outlook, LinkedIn, X, Slack, WhatsApp Web); every other site
  still works through the generic adapter. Each adapter degrades to
  draft-only if the host's DOM changes.

### Changed

- **Cleaner, less cluttered popover.** The configuration controls used to
  be three mismatched widget styles across three rows (a language row of
  dropdowns, a row of tone pills, and a wide model dropdown that truncated
  its own text). They are now one consistent set: From / To / Tone /
  Model are all the same compact select, in two tidy rows, with matching
  labels. The model picker shows just the short name ("GPT-4o mini") with
  the description on hover. Plus a visual refresh — softer card, flat
  header, accent-coloured active tab, calmer preview area.
- **Development CORS accepts any extension origin.** In `pnpm dev` the
  backend now accepts any `chrome-extension://` origin, so a freshly
  loaded unpacked extension works immediately — no need to copy its ID
  into `ALLOWED_EXTENSION_IDS` first. Production keeps the strict
  allowlist.
- **Production misconfiguration is now loud.** A production build with no
  `OPENAI_API_KEY` logs a startup `WARNING` — it would otherwise serve
  mock responses to real users with only a quiet `info` line.

## [1.0.0] — 2026-05-16

First production release. Bundles the multilingual support feature with
all the previously-unreleased work since `0.1.0`.

### Added

- **Integrated multilingual support.** A new shared **language catalog**
  (`@inkwell/shared/languages.ts`) — 15 languages (English, French,
  German, Spanish, Italian, Portuguese, Dutch, Polish, Russian, Japanese,
  Chinese Simplified & Traditional, Korean, Arabic, Hindi) — is the single
  source of truth that the request schema, the popover pickers, and the
  prompt builder all derive from. Adding a language is a one-line change.
- **Translate action.** A fourth popover action translates an incoming
  customer query (or any text) into a chosen language. The model is
  instructed to translate faithfully and never act on the content, which
  also hardens it against prompt injection in the translated text.
- **Inline language detection.** The extension detects the source language
  locally via `chrome.i18n.detectLanguage` — no network call, no extra
  permission — and shows it in the popover ("From · French"). Detection
  also seeds the request's `sourceLanguage`; the backend model still
  verifies it, so a miss only costs a hint.
- **Context-aware reply languages.** The reply action can produce the
  draft in the customer's language, the agent's working language, any
  catalog language, or **bilingual** (both at once).
- **Cross-language grammar & rewrite.** Grammar correction stays in the
  text's own language (never translates); rewrite can optionally output
  into another language.
- **Translation & action history.** Every completed translation and draft
  is recorded in a new on-device store (`extension/src/lib/history.ts`,
  `chrome.storage.local`, bounded to 250 entries). A new **History** tab
  in the options page makes it searchable and filterable by action,
  language, and conversation.
- **Agent language preferences.** A new **Languages** tab lets each agent
  set a working language and frequently-used languages; the latter are
  surfaced first in the popover's language pickers.
- Request/response contract gained `sourceLanguage`, `targetLanguage`, and
  `bilingual` fields; the audit log records language ids (never content)
  for per-language quality metrics.
- **Configurable backend (bring your own backend).** The backend URL is
  a runtime setting in the options page ("Backend" tab), with an optional
  API key sent as `Authorization: Bearer`. The extension can be pointed
  at any server implementing the Inkwell API contract — no rebuild. Uses
  MV3 `optional_host_permissions` so Chrome grants access to exactly the
  configured origin; includes a "Save & test" health-check flow. See
  `docs/how-to/use-your-own-backend.md`.
- **User-selectable model.** The popover has a model picker; the chosen
  model is sent per-request and used to serve it. The options page lets
  you set a default model.
- **Model catalog** (`@inkwell/shared/models.ts`) — single source of truth
  for supported models (id, label, provider, description, tier).
- **Provider abstraction** (`backend/lib/providers/`) — a
  `CompletionProvider` interface + registry keyed on `ModelProvider`.
  Adding a non-OpenAI provider is a new file + registry entry, no
  pipeline/route/schema/UI changes. See
  `docs/explanation/model-providers.md`. Today only OpenAI ships.
- LICENSE, .editorconfig, .prettierrc, .prettierignore, and a GitHub
  Actions CI workflow (`.github/workflows/ci.yml`) gating merges on a
  clean install + typecheck + build.

### Removed

- **Authentication (Clerk) removed entirely.** The extension calls the
  backend anonymously — no sign-in, no tokens, no JWT verification.
  Deleted: `/auth/*` pages, `lib/auth.ts`, all `@clerk/nextjs` usage.
- **Database (Turso/libSQL + Drizzle ORM) removed entirely.** No
  server-side profile store, no audit-log table. Deleted: `db/`,
  `drizzle/`, `lib/db.ts`, `drizzle.config.ts`, the `/api/v1/profile`
  and `/api/v1/usage` routes, and the `@libsql/client` / `drizzle-orm` /
  `drizzle-kit` / `tsx` dependencies.

### Changed

- The product is a **multilingual** writing assistant — manifest, popup,
  options, and landing copy updated accordingly.
- The extension works **without an account**. All user settings
  (profile, default tone/model, languages, site allow/blocklist) live in
  `chrome.storage.local` only.
- Rate limiting is an **in-memory per-IP sliding window**
  (`lib/rate-limit.ts`), not Turso-backed per-user counters.
- Audit logging is **stdout-only structured JSON** (`lib/audit-log.ts`);
  no database sink.
- `middleware.ts` reduced to CORS only (no JWT, no `clerkMiddleware`).
- The backend API surface is just `/api/v1/health` and
  `/api/v1/complete`.
- Optional personalization is carried on the completion request itself
  (`profile` field) instead of a server-side profile store.
- Renamed the project from "AI Writing Assistant" / `@aiwa/*` to
  **Inkwell** / `@inkwell/*`.

## [0.1.0] — 2026-05-09

### Added

- **Monorepo scaffolding** with pnpm workspaces (`shared`, `backend`,
  `extension`) and TypeScript strict mode everywhere.
- **Backend** (Next.js 15 App Router):
  - `/api/v1/health` (Edge), `/api/v1/complete` (Node, streaming),
    `/api/v1/profile` (Node), `/api/v1/usage` (Node).
  - `/auth/sign-in`, `/auth/sign-up`, `/auth/extension-callback` powered
    by Clerk (`@clerk/nextjs`) — Google OAuth + email/password.
  - Edge middleware: CORS lockdown to extension IDs, JWT verification
    via `jose` + Clerk SPKI, request-header injection (x-inkwell-user-id).
  - **Turso (libSQL) + Drizzle ORM** for profile storage and
    metadata-only audit logs. Migrations committed.
  - **Rate limiting** computed against the `audit_logs` table — no
    separate Redis. 20 req/min, 500 req/day per user, fail-closed in
    production.
  - **Prompt-injection defense**: `<UNTRUSTED_CONTEXT>` delimiters,
    role-marker stripping, heuristic refusal, length caps,
    preview-before-insert.
  - Three rewrite modes (transform / light edit / compose-from-brief).
  - Vercel build pipeline with auto-migrations (`tsx db/migrate.ts &&
    next build`).
- **Extension** (Manifest V3 + Vite + CRXJS):
  - Content script with site adapters: generic, Gmail, LinkedIn, X.
  - Closed Shadow-DOM popover with persistent DOM (no re-renders),
    streaming caret, keyboard shortcuts (Esc / Cmd+Enter), full
    accessibility (role="dialog", aria-live), dark-mode via
    prefers-color-scheme.
  - Floating ✨ trigger with Lucide-style SVG, hover tooltip, fade-in
    animation, hide-while-typing.
  - Background service worker: silent token refresh via the auth-callback
    page so Clerk's short-lived JWTs don't force re-sign-in.
  - Refresh tokens AES-256-GCM encrypted at rest in `chrome.storage.local`.
  - Site policy: default-blocked banking/healthcare/password-manager
    sites; user allow/blocklist editor in options.
  - Polished React popup (avatar, current-site quick toggle, keyboard
    hint) and tabbed options page.
- **Documentation** under `docs/` following the
  [Diátaxis](https://diataxis.fr) framework: tutorial, how-to,
  reference, and explanation. Sections: getting-started, deployment,
  database, secrets rotation, site adapters, auth config, API, error
  codes, environment, architecture, prompt-injection defense, streaming
  design, rewrite modes, security, privacy, contributing.

[Unreleased]: https://example.com/compare/v1.1.0...HEAD
[1.1.0]: https://example.com/compare/v1.0.0...v1.1.0
[1.0.0]: https://example.com/compare/v0.1.0...v1.0.0
[0.1.0]: https://example.com/releases/v0.1.0
