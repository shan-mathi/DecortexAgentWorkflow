// Deterministic, deployable LLMProvider.
//
// Determinism is the central guarantee:
//   - `complete(prompt)` returns the canned response keyed by `sha1(prompt)`,
//     or `defaultFor(prompt)` when no entry is registered. Identical prompts
//     produce byte-identical text.
//   - `embed(text)` derives an `embeddingDim`-long vector from
//     `sha256(text)`, L2-normalised. Identical text produces a byte-
//     identical vector.
//
// On top of determinism, two knobs make this useful for testing real
// failure modes without a real provider:
//   - `latency`: sleeps for a sample drawn from a chosen distribution.
//   - `failure`: with probability `rate`, throws a typed error.
//
// Token usage is estimated from text length so that integration tests
// can assert *that* tokens were attributed without depending on a real
// tokeniser.

import { createHash } from "node:crypto";

import type { LLMProvider, TokenUsage } from "@workflow-engine/shared";

import { type FailureConfig, failureForKind, rollFailure } from "./failures.js";
import { type LatencyConfig, sampleLatencyMs, sleep } from "./latency.js";
import { seededRng } from "./random.js";

export interface FakeLLMOptions {
  /** Map from `sha1(prompt)` to canned response text. */
  cannedResponses?: Map<string, string>;
  latency?: LatencyConfig;
  failure?: FailureConfig;
  /** Default 1536 to match OpenAI text-embedding-3-small. */
  embeddingDim?: number;
  /** Override RNG for deterministic latency / failure rolls in tests. */
  rng?: () => number;
}

const DEFAULT_DIM = 1536;

function sha1(s: string): string {
  return createHash("sha1").update(s).digest("hex");
}

function defaultFor(prompt: string): string {
  // Stable, prompt-shaped default. Useful for prompts that the test
  // author hasn't bothered to can — they still get a non-empty,
  // deterministic answer.
  const tag = sha1(prompt).slice(0, 8);
  return `[fake-llm:${tag}] response for prompt of length ${prompt.length}`;
}

/**
 * Rough 4-chars-per-token heuristic. Good enough for trace-level
 * attribution; not for billing.
 */
function estimateTokens(prompt: string, completion: string): TokenUsage {
  return {
    promptTokens: Math.max(1, Math.ceil(prompt.length / 4)),
    completionTokens: Math.max(1, Math.ceil(completion.length / 4)),
  };
}

function l2Normalise(vec: number[]): number[] {
  let sum = 0;
  for (const v of vec) sum += v * v;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

export class FakeLLM implements LLMProvider {
  private readonly canned: Map<string, string>;
  private readonly latency: LatencyConfig | undefined;
  private readonly failure: FailureConfig | undefined;
  private readonly dim: number;
  private readonly rng: () => number;

  constructor(opts: FakeLLMOptions = {}) {
    this.canned = opts.cannedResponses ?? new Map();
    this.latency = opts.latency;
    this.failure = opts.failure;
    this.dim = opts.embeddingDim ?? DEFAULT_DIM;
    this.rng = opts.rng ?? Math.random;
  }

  async complete(args: {
    prompt: string;
    model: string;
    maxTokens?: number;
  }): Promise<{ text: string; tokenUsage: TokenUsage }> {
    await sleep(sampleLatencyMs(this.latency, this.rng));
    if (rollFailure(this.failure, this.rng)) {
      throw failureForKind(this.failure!.kind);
    }
    const key = sha1(args.prompt);
    const text = this.canned.get(key) ?? defaultFor(args.prompt);
    return { text, tokenUsage: estimateTokens(args.prompt, text) };
  }

  async embed(args: {
    text: string;
    model?: string;
  }): Promise<{ vector: number[]; tokenUsage: TokenUsage }> {
    await sleep(sampleLatencyMs(this.latency, this.rng));
    if (rollFailure(this.failure, this.rng)) {
      throw failureForKind(this.failure!.kind);
    }
    const r = seededRng(args.text);
    const raw = Array.from({ length: this.dim }, () => r() * 2 - 1);
    const vector = l2Normalise(raw);
    return {
      vector,
      tokenUsage: {
        promptTokens: Math.max(1, Math.ceil(args.text.length / 4)),
        completionTokens: 0,
      },
    };
  }
}
