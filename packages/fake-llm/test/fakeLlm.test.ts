// Determinism, latency sampling, and failure-injection tests for FakeLLM.
//
// What we are buying with each test:
//
//   - Determinism: same prompt → same text; same text → same vector.
//     This is what makes downstream integration tests gating: the engine
//     can run the full workflow with FakeLLM and assert exact outputs.
//
//   - L2 normalisation: pgvector cosine queries assume unit vectors;
//     drift here would silently degrade retrieval ordering tests.
//
//   - Failure injection: rate=1 always throws, rate=0 never throws.
//     With a fixed RNG, in-between rates are determined too — useful for
//     load-test reproducibility.

import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  FakeLLM,
  MalformedJsonError,
  RateLimitError,
  TimeoutError,
  sampleLatencyMs,
} from "../src/index.js";

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

describe("FakeLLM.complete", () => {
  it("returns byte-identical text for the same prompt", async () => {
    const llm = new FakeLLM();
    const a = await llm.complete({ prompt: "hello", model: "x" });
    const b = await llm.complete({ prompt: "hello", model: "x" });
    expect(a.text).toBe(b.text);
  });

  it("uses canned responses keyed by sha1(prompt) when present", async () => {
    const canned = new Map<string, string>();
    canned.set(sha1("ping"), "pong");
    const llm = new FakeLLM({ cannedResponses: canned });
    const r = await llm.complete({ prompt: "ping", model: "x" });
    expect(r.text).toBe("pong");
  });

  it("estimates non-zero token usage on prompt + completion", async () => {
    const llm = new FakeLLM();
    const r = await llm.complete({ prompt: "hello world", model: "x" });
    expect(r.tokenUsage.promptTokens).toBeGreaterThan(0);
    expect(r.tokenUsage.completionTokens).toBeGreaterThan(0);
  });
});

describe("FakeLLM.embed", () => {
  it("returns the same vector for the same text", async () => {
    const llm = new FakeLLM({ embeddingDim: 16 });
    const a = await llm.embed({ text: "outage" });
    const b = await llm.embed({ text: "outage" });
    expect(a.vector).toEqual(b.vector);
  });

  it("returns L2-normalised vectors (norm ≈ 1)", async () => {
    const llm = new FakeLLM({ embeddingDim: 64 });
    const { vector } = await llm.embed({ text: "any text" });
    const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
    expect(Math.abs(norm - 1)).toBeLessThan(1e-9);
  });

  it("returns the configured number of dimensions", async () => {
    const llm = new FakeLLM({ embeddingDim: 8 });
    const { vector } = await llm.embed({ text: "x" });
    expect(vector).toHaveLength(8);
  });

  it("attributes promptTokens but never completionTokens", async () => {
    const llm = new FakeLLM({ embeddingDim: 4 });
    const { tokenUsage } = await llm.embed({ text: "pretend embed" });
    expect(tokenUsage.promptTokens).toBeGreaterThan(0);
    expect(tokenUsage.completionTokens).toBe(0);
  });
});

describe("FakeLLM failure injection", () => {
  it("with rate=1 always throws the configured error", async () => {
    const llm = new FakeLLM({ failure: { kind: "rate-limit", rate: 1 } });
    await expect(llm.complete({ prompt: "x", model: "x" })).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });

  it("with rate=0 never throws", async () => {
    const llm = new FakeLLM({ failure: { kind: "timeout", rate: 0 } });
    for (let i = 0; i < 50; i++) {
      await expect(
        llm.complete({ prompt: `p${i}`, model: "x" }),
      ).resolves.toBeDefined();
    }
  });

  it("each failure kind throws the matching error class", async () => {
    const cases = [
      { kind: "timeout" as const, errCtor: TimeoutError },
      { kind: "malformed-json" as const, errCtor: MalformedJsonError },
    ];
    for (const c of cases) {
      const llm = new FakeLLM({ failure: { kind: c.kind, rate: 1 } });
      await expect(
        llm.complete({ prompt: "x", model: "x" }),
      ).rejects.toBeInstanceOf(c.errCtor);
    }
  });
});

describe("sampleLatencyMs", () => {
  it("constant returns mean exactly", () => {
    expect(sampleLatencyMs({ kind: "constant", mean: 100 })).toBe(100);
  });

  it("uniform draws in [0, 2*mean) using injected rng", () => {
    expect(sampleLatencyMs({ kind: "uniform", mean: 50 }, () => 0)).toBe(0);
    expect(sampleLatencyMs({ kind: "uniform", mean: 50 }, () => 0.5)).toBe(50);
    expect(sampleLatencyMs({ kind: "uniform", mean: 50 }, () => 0.999)).toBeCloseTo(
      99.9,
      1,
    );
  });

  it("exponential preserves the configured mean over many draws", () => {
    let i = 0;
    // Cycle a fixed sequence of pseudo-uniforms; the average of
    // `-ln(u)` over a uniform sample is 1, so the mean of the
    // resulting latencies should approach `mean`.
    const draws = [0.1, 0.3, 0.5, 0.7, 0.9, 0.2, 0.4, 0.6, 0.8, 0.05];
    const rng = () => draws[i++ % draws.length] ?? 0.5;
    let sum = 0;
    const N = 1000;
    for (let k = 0; k < N; k++) sum += sampleLatencyMs({ kind: "exponential", mean: 10 }, rng);
    const avg = sum / N;
    expect(avg).toBeGreaterThan(5);
    expect(avg).toBeLessThan(20);
  });
});

describe("FakeLLM latency", () => {
  it("sleeps for the constant duration before resolving", async () => {
    vi.useFakeTimers();
    try {
      const llm = new FakeLLM({ latency: { kind: "constant", mean: 200 } });
      const p = llm.complete({ prompt: "x", model: "x" });
      // Promise should not have resolved yet.
      let resolved = false;
      void p.then(() => {
        resolved = true;
      });
      await vi.advanceTimersByTimeAsync(199);
      expect(resolved).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      await p;
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
