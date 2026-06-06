// runNodeWithRetry — the wrapper that turns `executor.execute(...)`
// into a stable `NodeResult` with retry semantics.
//
// Why a wrapper and not retry inside each node:
//   - one place to set `durationMs` consistently
//   - one place to enforce "never throw, always return a NodeResult"
//   - per-node retry policy via `node.config.retry`
//   - `ctx.metadata.attempt` is incremented per attempt so node code
//     can log which attempt it is on
//
// The default policy matches the design: 3 attempts, 200 ms base,
// exponential 2^(attempt-1), 30% multiplicative jitter.

import type { NodeContext, NodeDef, NodeResult } from "@workflow-engine/shared";

import type { NodeExecutor } from "./registry.js";

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  jitter: number;
}

export const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 3,
  backoffMs: 200,
  jitter: 0.3,
};

/**
 * Marker class for errors that should NOT be retried even if attempts
 * remain. Sandbox / template / validation errors are typically
 * non-retryable: a flaky LLM is not going to fix a malformed prompt.
 */
export class NonRetryableError extends Error {
  override readonly name = "NonRetryableError";
  readonly inner: Error;
  constructor(inner: Error) {
    super(inner.message);
    this.inner = inner;
  }
}

export interface RunNodeDeps {
  /**
   * Defaults to `Date.now()`. Tests inject a fixed clock to assert
   * `durationMs` exactly.
   */
  now?: () => number;
  /**
   * Defaults to `setTimeout`. Tests inject a no-op or fake-timer-aware
   * sleeper to keep retry tests fast.
   */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Defaults to `Math.random`. Tests inject a deterministic source.
   */
  rng?: () => number;
}

function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}

function jittered(base: number, jitter: number, rng: () => number): number {
  // Multiplicative jitter: base ± (base * jitter * rng())
  const sign = rng() < 0.5 ? -1 : 1;
  return Math.max(0, base + sign * base * jitter * rng());
}

function readPolicy(node: NodeDef): RetryPolicy {
  const cfg = (node.config ?? {}) as { retry?: Partial<RetryPolicy> };
  return { ...DEFAULT_RETRY, ...(cfg.retry ?? {}) };
}

/**
 * Execute `executor` once, with retries on thrown errors.
 *
 * Pre:  `ctx.upstream` is populated for `node`'s parents.
 * Post: returns a NodeResult — never throws. On terminal failure,
 *       `status === "FAILED"` and `error` is populated.
 *
 * Invariants:
 *   - `ctx.metadata.attempt` increases monotonically per attempt
 *   - `result.durationMs` measures the FINAL attempt only
 *     (matches the design wording "the resolution of its returned promise")
 */
export async function runNodeWithRetry(
  node: NodeDef,
  executor: NodeExecutor,
  ctx: NodeContext,
  deps: RunNodeDeps = {},
): Promise<NodeResult> {
  const policy = readPolicy(node);
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? defaultSleep;
  const rng = deps.rng ?? Math.random;

  let attempt = 0;
  while (attempt < policy.maxAttempts) {
    attempt += 1;
    ctx.metadata.attempt = attempt;
    const started = now();
    try {
      const parsedConfig = executor.configSchema.parse(node.config);
      const r = await executor.execute(parsedConfig, ctx);
      // Wrapper sets durationMs authoritatively — node implementations
      // commonly leave it as 0.
      r.durationMs = now() - started;
      return r;
    } catch (err) {
      const isLast = attempt === policy.maxAttempts;
      const nonRetryable = err instanceof NonRetryableError;
      if (isLast || nonRetryable) {
        const e = nonRetryable ? (err as NonRetryableError).inner : (err as Error);
        return {
          output: null,
          status: "FAILED",
          error: { message: e.message, stack: e.stack },
          durationMs: now() - started,
        };
      }
      const wait = jittered(
        policy.backoffMs * Math.pow(2, attempt - 1),
        policy.jitter,
        rng,
      );
      await sleep(wait);
    }
  }
  // Unreachable: the loop either returns on success or returns on the
  // last-attempt catch. Kept for type narrowing.
  throw new Error("runNodeWithRetry: unreachable");
}
