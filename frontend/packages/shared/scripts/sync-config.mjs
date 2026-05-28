#!/usr/bin/env node
// Sync the backend-owned model catalog into the shared package so
// tsc can inline it at build time.
//
// The canonical file lives at:
//   backend/src/inkwell_backend/config/models.catalog.json
//
// It is copied (unchanged) to:
//   frontend/packages/shared/src/_generated/models.catalog.json
//
// `_generated/` is .gitignored — only the backend's copy is tracked.
// This script runs:
//   - as `presync` / `pretypecheck` / `prebuild` for @inkwell/shared
//   - in CI as a drift check (pass --check to fail instead of writing)
//
// Validation happens at read time, not here. Keep the script
// dependency-free (only Node stdlib) so it works on a clean checkout
// without an extra `pnpm install` step.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// packages/shared/scripts → packages/shared → packages → frontend → repo root
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");

const SOURCE = resolve(
  REPO_ROOT,
  "backend",
  "src",
  "inkwell_backend",
  "config",
  "models.catalog.json",
);

const TARGET = resolve(HERE, "..", "src", "_generated", "models.catalog.json");

const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");

if (!existsSync(SOURCE)) {
  console.error(`[sync-config] source JSON missing: ${SOURCE}`);
  console.error(
    "[sync-config] expected the backend repo layout — has the catalog been moved?",
  );
  process.exit(1);
}

const sourceBytes = readFileSync(SOURCE);

if (checkOnly) {
  if (!existsSync(TARGET)) {
    console.error(`[sync-config] drift: generated copy missing (${TARGET})`);
    console.error("[sync-config] run `pnpm -F @inkwell/shared sync-config` and commit nothing — _generated/ is ignored.");
    process.exit(2);
  }
  const targetBytes = readFileSync(TARGET);
  if (!sourceBytes.equals(targetBytes)) {
    console.error("[sync-config] drift: backend catalog and generated copy differ");
    console.error(`[sync-config] source: ${SOURCE}`);
    console.error(`[sync-config] target: ${TARGET}`);
    process.exit(2);
  }
  console.log("[sync-config] in sync ✓");
  process.exit(0);
}

mkdirSync(dirname(TARGET), { recursive: true });
writeFileSync(TARGET, sourceBytes);
console.log(`[sync-config] ${SOURCE} → ${TARGET}`);
