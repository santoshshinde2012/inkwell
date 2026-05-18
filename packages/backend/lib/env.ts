// Single read-once view of the environment. Anything that consumes process.env
// goes through here so we get a clean compile-time list of required vars.
//
// This deployment has NO authentication and NO database — the only external
// dependency is OpenAI. The Chrome extension calls the backend anonymously;
// all user settings live in the extension's chrome.storage.local.

import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),

  // Comma-separated list of chrome-extension://… origins. Empty = no extension
  // is allowed (we still permit the local Next.js page itself via same-origin).
  ALLOWED_EXTENSION_IDS: z.string().default(""),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_DEFAULT_MODEL: z.string().default("gpt-4o-mini"),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // Fail loud at startup if env shape is invalid (don't reveal contents).
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", parsed.error.flatten());
  throw new Error("Invalid environment configuration");
}

export const env = parsed.data;

export const allowedExtensionOrigins: readonly string[] = env.ALLOWED_EXTENSION_IDS
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const features = {
  hasOpenAI: !!env.OPENAI_API_KEY,
  isProd: env.NODE_ENV === "production",
} as const;

// Loud once-per-boot summary so deploys make it obvious whether OpenAI is
// live or the mock streaming response is being served.
if (process.env.NODE_ENV !== "test") {
  // eslint-disable-next-line no-console
  console.info(`[inkwell] features: openai=${features.hasOpenAI}`);
  // A production deploy with no key is almost certainly a misconfiguration:
  // /api/v1/complete would serve mock text to real users. Flag it loudly.
  if (features.isProd && !features.hasOpenAI) {
    // eslint-disable-next-line no-console
    console.warn(
      "[inkwell] WARNING: production build with no OPENAI_API_KEY — " +
        "/api/v1/complete will serve MOCK responses, not real model output.",
    );
  }
}
