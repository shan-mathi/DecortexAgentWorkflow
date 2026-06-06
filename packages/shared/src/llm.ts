// LLMProvider — the single interface every LLM-touching call goes through.
//
// `complete` is generation; `embed` is vector-embedding for retrieval.
// Selecting between FakeLLM, OpenAI, and Anthropic happens at process
// start via `LLM_PROVIDER` env var; the engine never knows which one it
// has, only that it implements this contract.
//
// `embed` is a peer of `complete` (not a side feature on `complete`)
// because retrieval is a first-class workflow primitive — the
// `kb-retrieval` plugin needs deterministic vectors in tests, and
// real embedding endpoints are billed and shaped differently from
// chat-completion endpoints.

import type { TokenUsage } from "./node.js";

export interface LLMProvider {
  complete(args: {
    prompt: string;
    model: string;
    maxTokens?: number;
  }): Promise<{ text: string; tokenUsage: TokenUsage }>;

  embed(args: {
    text: string;
    model?: string;
  }): Promise<{ vector: number[]; tokenUsage: TokenUsage }>;
}
