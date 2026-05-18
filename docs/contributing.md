# Contributing

_For someone making a code or docs change to the project._

Thanks for taking the time to contribute. This page covers how to set
up, what we expect from changes, and how to get them reviewed.

## Setup

See [Getting started](./getting-started.md). It takes about 10 minutes.

## Branching and commits

- Branch from `main`. Name branches `<type>/<short-description>`, e.g.
  `feat/slack-adapter`, `fix/cors-preflight`, `docs/api-reference`.
- One logical change per pull request. If you find yourself wanting to
  describe the change with "and", split the PR.
- Commit messages: imperative mood, lowercase first word. Example:
  `add slack adapter`, not `Added slack adapter`.

## Code style

- **TypeScript strict** is on across all packages. Don't add `any`,
  don't disable strict checks. If you genuinely need `any`, leave a
  one-line comment explaining why.
- **Schemas** for any data crossing a boundary (HTTP, `chrome.runtime`,
  storage). Schemas live in `packages/shared/src/schemas.ts` and
  `messages.ts`.
- **No silent fallbacks.** When something fails (DB unreachable, OpenAI
  timeout), surface it via the error envelope or a startup warning —
  don't pretend it didn't happen.
- **Default to no comments.** Prefer well-named identifiers. Add a
  comment only when the *why* is non-obvious (a security trade-off, a
  workaround for a specific bug, an invariant the type system can't
  express).
- **Commit lockfile changes.** `pnpm-lock.yaml` is committed.

## Tests

We don't yet have a test suite. Manual verification is the bar:

- Run `pnpm typecheck` — must pass.
- Run `pnpm build` — must pass.
- Exercise the changed path end-to-end. The `curl` recipes in
  [How-to: Local development](./how-to/local-development.md) are a
  starting point.

If you add code that's hard to verify by hand (e.g., a non-trivial
algorithm), add a test in the package's `*.test.ts` and update the
build script.

## Documentation

Docs are part of the change. If you ship a feature, ship the doc.

The right place to put it depends on what kind of doc it is:

| Kind | Where |
| --- | --- |
| Tutorial (learning-oriented) | `docs/getting-started.md` (extend) |
| How-to (task-oriented recipe) | `docs/how-to/<task>.md` |
| Reference (look-up) | `docs/reference/<topic>.md` |
| Explanation (the *why*) | `docs/explanation/<concept>.md` |

If your change touches an existing doc, update it. Stale docs are
worse than no docs.

## Pull requests

A good PR description includes:

1. **What** — one or two sentences describing the change.
2. **Why** — the user-facing reason or the bug being fixed.
3. **How verified** — what you ran and what you saw.
4. **Migration notes** — anything operators need to do (env vars,
   manual steps, breaking changes).

We aim to review PRs within two business days.

## Reporting bugs

Open a GitHub issue with:

- What you expected to happen
- What actually happened
- Steps to reproduce
- The environment (OS, browser, Node version, deployed vs local)

For **security** issues, see [security.md § Reporting a vulnerability](./security.md#reporting-a-vulnerability)
— don't open a public issue.

## Code of conduct

Be kind. Disagreements about technical choices are normal; insults are
not. Maintainers will moderate as needed.

## See also

- [Getting started](./getting-started.md)
- [How-to: Local development](./how-to/local-development.md)
- [Reference: Architecture](./reference/architecture.md)
