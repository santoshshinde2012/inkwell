# Inkwell — Documentation

This directory holds all project documentation. The top-level
[`README.md`](../README.md) is the entry point; depth lives here.

The structure follows the **[Diátaxis](https://diataxis.fr)** framework.

> **No accounts, no database.** Inkwell works anonymously. There is no
> sign-in and no database — the default upstream is OpenAI (optionally
> routed through the Portkey AI gateway as a transport-level toggle),
> and all extension settings and history live in `chrome.storage.local`.

## Where to start

| If you want to… | Read |
| --- | --- |
| Get the project running locally | [Getting started](./getting-started.md) |
| Develop one layer at a time | [How-to: Local development](./how-to/local-development.md) |
| Understand how the system fits together | [Reference: Architecture](./reference/architecture.md) |
| See the API contract | [Reference: API](./reference/api.md) |
| Point the extension at your own backend | [How-to: Use your own backend](./how-to/use-your-own-backend.md) |
| Understand the security model | [Security](./security.md) |
| Understand what data we process | [Privacy](./privacy.md) |
| Understand multilingual support | [Explanation: Multilingual support](./explanation/multilingual-support.md) |
| Add a new site adapter | [How-to: Add a site adapter](./how-to/add-a-site-adapter.md) |
| Contribute code | [Contributing](./contributing.md) |

## Layout

```
docs/
├── README.md                     ← you are here
├── getting-started.md            tutorial — clone to working extension
├── security.md                   threat model + reporting policy
├── privacy.md                    data-handling policy
├── contributing.md               PR / issue / code-style guide
├── how-to/                       task-oriented recipes
│   ├── local-development.md
│   ├── use-your-own-backend.md
│   └── add-a-site-adapter.md
├── reference/                    information-oriented (look-up)
│   ├── api.md
│   ├── architecture.md
│   ├── environment.md
│   └── error-codes.md
└── explanation/                  understanding-oriented (the *why*)
    ├── model-providers.md
    ├── multilingual-support.md
    ├── prompt-injection-defense.md
    ├── streaming-design.md
    └── three-rewrite-modes.md
```

## Conventions

- Code blocks declare a language. Untyped blocks imply shell.
- Links are relative within the repo.
- Time-sensitive content carries a `_Last updated:_` stamp.
- Callouts use blockquotes (**Note** / **Warning**).

## See also

- [Top-level README](../README.md) — overview, layout, quick start.
- [CHANGELOG](../CHANGELOG.md) — project history.
