# `@inkwell/frontend` — TypeScript workspace

The TypeScript half of Inkwell: the Chrome extension and the schemas it
shares with the Python backend in [`../backend/`](../backend/).

## Stack

| Concern | Choice |
|---|---|
| Language | TypeScript 5 (strict, including `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`) |
| Build | Vite 5 + `@crxjs/vite-plugin` for MV3 bundling |
| UI framework | React 18 (Side Panel + Options page); vanilla DOM in a closed Shadow root for the in-page popover |
| Styling | Tailwind 3 (React surfaces); a single template-literal CSS for the popover Shadow DOM |
| Lint + format | ESLint flat config + `typescript-eslint` + `eslint-plugin-react-hooks` + Prettier |
| Type validation | zod (re-uses Pydantic-mirrored shapes from `@inkwell/shared`) |
| Workspace | pnpm with `packages/` glob |

## Layout

```
frontend/
├── package.json              workspace root
├── pnpm-workspace.yaml       lists ./packages/{extension,shared}
├── pnpm-lock.yaml
├── tsconfig.base.json        strict TS settings — every package extends this
├── .prettierrc / .prettierignore
└── packages/
    ├── extension/            Chrome MV3 extension (the Inkwell UI)
    │   ├── manifest.config.ts
    │   ├── vite.config.ts
    │   ├── eslint.config.js
    │   ├── tailwind.config.ts
    │   ├── scripts/          icon raster generation
    │   ├── icons/            brand SVG + rasterised PNGs
    │   └── src/
    │       ├── background/   service worker + API/SSE client
    │       ├── content/      in-page trigger + popover + OCR loader + site adapters
    │       ├── lib/          storage, messaging, OCR, language detection, history
    │       ├── sidepanel/    React Side Panel (Assistant / History / Settings)
    │       ├── options/      React Options page (App + components + tabs/*)
    │       └── ui/           cross-surface bits (ErrorBoundary, global CSS, popover CSS)
    └── shared/               zod schemas + message contracts (consumed by extension)
        └── src/
            ├── actions.ts
            ├── tones.ts
            ├── models.ts
            ├── languages.ts
            ├── constants.ts
            ├── errors.ts
            ├── schemas.ts
            ├── messages.ts
            └── index.ts
```

The Python backend has a parallel mirror of `shared/`'s catalogs +
errors in
[`backend/src/inkwell_backend/domain/`](../backend/src/inkwell_backend/domain/);
keep both copies aligned when you add a model, language, action, or
tone.

## Common commands

From the repo root, the top-level Makefile delegates to this workspace:

```bash
make frontend                  # vite dev watcher (extension dist/)
make build                     # production build (shared + extension)
make lint                      # eslint
make typecheck                 # tsc --noEmit, every package
```

From inside `frontend/`:

```bash
pnpm dev:extension             # vite dev watcher
pnpm build                     # shared + extension production builds
pnpm typecheck                 # tsc --noEmit, every package
pnpm lint                      # eslint
pnpm format                    # prettier --write
pnpm format:check              # CI-gating formatter check
pnpm clean                     # rm -rf dist + node_modules
```

For per-package commands run `pnpm --filter @inkwell/extension <cmd>` or
`pnpm --filter @inkwell/shared <cmd>`.

## Loading the extension into Chrome

```bash
make frontend            # writes packages/extension/dist/
```

Then in Chrome:

1. `chrome://extensions`
2. Toggle **Developer mode**
3. **Load unpacked** → select `frontend/packages/extension/dist/`
4. After a code change, click the reload icon on the extension card.

In dev mode the backend accepts any `chrome-extension://` origin, so
the extension works out of the box without copying its id into
`ALLOWED_EXTENSION_IDS`.

## Coding conventions

- **Strict TS**, no `any`, no `@ts-ignore`. The two `as` casts in the
  codebase are documented at their use sites.
- **Schemas at every boundary**: HTTP request/response, `chrome.runtime`
  message channel, `chrome.storage.local` — all zod-validated.
- **No content logging**: only request metadata reaches console / the
  backend.
- **Hooks rules + exhaustive-deps** enforced by ESLint.
- **Prettier-formatted**; CI gates on `pnpm format:check`.

## See also

- [`../docs/reference/architecture.md`](../docs/reference/architecture.md) — full layout walkthrough
- [`../docs/how-to/local-development.md`](../docs/how-to/local-development.md) — running both halves locally
- [`../docs/how-to/add-a-site-adapter.md`](../docs/how-to/add-a-site-adapter.md) — adding a new site
- [`../backend/README.md`](../backend/README.md) — the FastAPI service this talks to
