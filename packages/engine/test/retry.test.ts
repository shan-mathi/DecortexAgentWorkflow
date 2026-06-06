// `runNodeWithRetry` tests.
//
// Five behaviours covered:
//   - Success on first attempt: no sleeps, durationMs from injected clock.
//   - Success after transient failures: counted attempts match policy.
//   - Exhaustion: after `maxAttempts`, returns FAILED with the last error.
//   - NonRetryableError short-circuits before retries are exhausted.
//   - `ctx.metadata.attempt` is incremented per attempt.

import { z } from "zod";

import { describe, expect, it } from "vitest";

import type { NodeContext, NodeDef, NodeResult } from "@workflow-engine/shared";

import { NonRetryableError, runNodeWithRetry } from "../src/retry.js";
import type { NodeExecutor } from "../src/registry.js";

function defNode(retry?: { maxAttempts: number; backoffMs: number; jitter: number }): NodeDef {
  return {
    id: "n",
    type: "test",
    config: retry ? { retry } : {},
    position_x: 0,
    position_y: 0,
  };
}

function makeCtx(): NodeContext {
  return {
    runId: "r",
    nodeId: "n",
    runInput: null,
    upstream: {},
    metadata: { workflowId: "w", attempt: 0 },
  };
}

function makeExecutor(impl: () => Promise<NodeResult>): NodeExecutor {
  return {
    type: "test",
    configSchema: z.unknown(),
    execute: impl,
  };
}

describe("runNodeWithRetry", () => {
  it("succeeds on first attempt", async () => {
    let calls = 0;
    const exec = makeExecutor(async () => {
      calls += 1;
      return { output: { ok: true }, status: "SUCCEEDED", durationMs: 0 };
    });
    const ctx = makeCtx();
    const r = await runNodeWithRetry(defNode(), exec, ctx);
    expect(calls).toBe(1);
    expect(r.status).toBe("SUCCEEDED");
    expect(ctx.metadata.attempt).toBe(1);
  });

  it("retries transient errors and eventually succeeds", async () => {
    let calls = 0;
    const exec = makeExecutor(async () => {
      calls += 1;
      if (calls < 3) throw new Error("transient");
      return { output: "ok", status: "SUCCEEDED", durationMs: 0 };
    });
    const ctx = makeCtx();
    const r = await runNodeWithRetry(
      defNode({ maxAttempts: 5, backoffMs: 1, jitter: 0 }),
      exec,
      ctx,
      { sleep: () => Promise.resolve() },
    );
    expect(calls).toBe(3);
    expect(r.status).toBe("SUCCEEDED");
    expect(ctx.metadata.attempt).toBe(3);
  });

  it("returns FAILED after exhausting maxAttempts", async () => {
    let calls = 0;
    const exec = makeExecutor(async () => {
      calls += 1;
      throw new Error("always");
    });
    const r = await runNodeWithRetry(
      defNode({ maxAttempts: 3, backoffMs: 1, jitter: 0 }),
      exec,
      makeCtx(),
      { sleep: () => Promise.resolve() },
    );
    expect(calls).toBe(3);
    expect(r.status).toBe("FAILED");
    expect(r.error?.message).toBe("always");
  });

  it("short-circuits on NonRetryableError without further attempts", async () => {
    let calls = 0;
    const exec = makeExecutor(async () => {
      calls += 1;
      throw new NonRetryableError(new Error("bad config"));
    });
    const r = await runNodeWithRetry(
      defNode({ maxAttempts: 5, backoffMs: 1, jitter: 0 }),
      exec,
      makeCtx(),
      { sleep: () => Promise.resolve() },
    );
    expect(calls).toBe(1);
    expect(r.status).toBe("FAILED");
    expect(r.error?.message).toBe("bad config");
  });

  it("measures durationMs from the injected clock", async () => {
    let t = 1000;
    const exec = makeExecutor(async () => {
      t += 250;
      return { output: null, status: "SUCCEEDED", durationMs: 0 };
    });
    const r = await runNodeWithRetry(defNode(), exec, makeCtx(), {
      now: () => t,
    });
    expect(r.durationMs).toBe(250);
  });
});
