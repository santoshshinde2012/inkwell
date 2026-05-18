// OpenAI completion provider.
//
// Implements the provider-neutral `CompletionProvider` interface. The OpenAI
// SDK is dynamically imported only when a key is configured, so mock-only
// deployments stay slim. When no key is set, `streamCompletion` yields a
// deterministic mock response so local dev needs zero secrets.

import { LIMITS } from "@inkwell/shared";
import { env, features } from "../env";
import type {
  CompletionChunk,
  CompletionProvider,
  ProviderCompletionArgs,
} from "./types";

async function* realStream(
  args: ProviderCompletionArgs,
): AsyncGenerator<CompletionChunk, void, unknown> {
  // Lazy import so mock-only deployments don't bundle the SDK eagerly.
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY! });

  const stream = await client.chat.completions.create(
    {
      model: args.model,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: LIMITS.MAX_RESPONSE_TOKENS,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
    },
    { signal: args.signal ?? null },
  );

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield { delta };
    if (chunk.usage) {
      yield {
        usage: {
          promptTokens: chunk.usage.prompt_tokens ?? 0,
          completionTokens: chunk.usage.completion_tokens ?? 0,
          totalTokens: chunk.usage.total_tokens ?? 0,
          model: chunk.model ?? args.model,
        },
      };
    }
  }
}

async function* mockStream(
  args: ProviderCompletionArgs,
): AsyncGenerator<CompletionChunk, void, unknown> {
  // Deterministic, human-looking response so the UI can be demoed without
  // burning tokens. A few line breaks exercise wrapping/scrolling.
  const phrases = [
    "Thanks for reaching out — ",
    "I appreciate the context you shared. ",
    "Here's a draft you can use as a starting point:\n\n",
    "I'm happy to keep iterating ",
    "until it sounds exactly right. ",
    "Let me know what you'd like to ",
    "tweak — tone, length, or any ",
    "specific points to add.\n\n",
    "(This is a mock response from the local backend. ",
    "Configure OPENAI_API_KEY to see real model output.)",
  ];

  for (const phrase of phrases) {
    if (args.signal?.aborted) return;
    yield { delta: phrase };
    await new Promise((r) => setTimeout(r, 60 + Math.random() * 80));
  }

  yield {
    usage: {
      promptTokens: Math.ceil((args.system.length + args.user.length) / 4),
      completionTokens: 64,
      totalTokens: 0,
      model: `${args.model} (mock)`,
    },
  };
}

class OpenAiProvider implements CompletionProvider {
  readonly id = "openai" as const;
  readonly configured = features.hasOpenAI;

  streamCompletion(
    args: ProviderCompletionArgs,
  ): AsyncGenerator<CompletionChunk, void, unknown> {
    return this.configured ? realStream(args) : mockStream(args);
  }
}

export const openAiProvider: CompletionProvider = new OpenAiProvider();
