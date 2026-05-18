// Completion provider abstraction.
//
// A `CompletionProvider` is one upstream that can serve a model — today only
// OpenAI, but the interface is deliberately provider-neutral so a new
// integration (Anthropic, Google, a local model, …) is a new file
// implementing this interface plus a registry entry. Nothing in the route
// handler or the completion pipeline knows which provider it's talking to.

import type { ModelProvider } from "@inkwell/shared";

export interface ProviderCompletionArgs {
  /** Catalog model id, e.g. "gpt-4o-mini". */
  model: string;
  system: string;
  user: string;
  /** Aborted when the HTTP client disconnects. */
  signal?: AbortSignal;
}

export interface CompletionChunk {
  /** A streamed token / text fragment. */
  delta?: string;
  /** Final usage accounting, emitted once at the end of the stream. */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    model: string;
  };
}

export interface CompletionProvider {
  /** Stable provider id — matches `ModelProvider` in the shared catalog. */
  readonly id: ModelProvider;

  /**
   * True when real credentials are configured. A provider that is NOT
   * configured must still implement `streamCompletion` and yield a usable
   * mock response, so local development works with zero secrets.
   */
  readonly configured: boolean;

  /**
   * Stream a completion. Yields `{ delta }` chunks as the model produces
   * text and one final `{ usage }` chunk. Must honor `args.signal` so
   * client disconnects free upstream resources.
   */
  streamCompletion(
    args: ProviderCompletionArgs,
  ): AsyncGenerator<CompletionChunk, void, unknown>;
}
