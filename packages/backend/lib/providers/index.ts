// Provider registry.
//
// Maps each `ModelProvider` to its `CompletionProvider` implementation. The
// `Record<ModelProvider, …>` type means that when you widen the
// `ModelProvider` union in @inkwell/shared (to onboard a new integration),
// TypeScript forces you to register a matching provider here — you can't
// ship a model whose provider doesn't exist.
//
// The completion pipeline calls `getProviderForModel(modelId)` and never
// needs to know which concrete provider it got.

import { type ModelProvider, providerForModel } from "@inkwell/shared";
import type { CompletionProvider } from "./types";
import { openAiProvider } from "./openai";

const PROVIDERS: Record<ModelProvider, CompletionProvider> = {
  openai: openAiProvider,
};

/** Resolve the provider that serves a given catalog model id. */
export const getProviderForModel = (modelId: string): CompletionProvider =>
  PROVIDERS[providerForModel(modelId)];
