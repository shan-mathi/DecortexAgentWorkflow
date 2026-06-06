// Forceable failure modes for FakeLLM.
//
// Each kind maps to a real failure shape we want to test the engine
// against:
//   - timeout       → `TimeoutError`, retryable
//   - rate-limit    → `RateLimitError`, retryable (with backoff)
//   - malformed-json → `MalformedJsonError`, non-retryable (LLM gave us
//                     well-formed text but the parser downstream chokes)
//   - partial       → `PartialOutputError`, non-retryable (truncation)
//
// `rate` is the probability per call that the configured failure fires,
// in `[0, 1]`. Tests pass `rate=1` to force every call to fail and
// `rate=0` to assert never-fail; load tests use small numbers like 0.01.

export type FailureKind = "timeout" | "rate-limit" | "malformed-json" | "partial";

export interface FailureConfig {
  kind: FailureKind;
  rate: number;
}

export class TimeoutError extends Error {
  override readonly name = "TimeoutError";
}
export class RateLimitError extends Error {
  override readonly name = "RateLimitError";
}
export class MalformedJsonError extends Error {
  override readonly name = "MalformedJsonError";
}
export class PartialOutputError extends Error {
  override readonly name = "PartialOutputError";
}

const messages: Record<FailureKind, string> = {
  timeout: "fake-llm: request timed out",
  "rate-limit": "fake-llm: rate limited",
  "malformed-json": "fake-llm: returned malformed JSON",
  partial: "fake-llm: response was truncated",
};

export function failureForKind(kind: FailureKind): Error {
  switch (kind) {
    case "timeout":
      return new TimeoutError(messages.timeout);
    case "rate-limit":
      return new RateLimitError(messages["rate-limit"]);
    case "malformed-json":
      return new MalformedJsonError(messages["malformed-json"]);
    case "partial":
      return new PartialOutputError(messages.partial);
  }
}

/**
 * Returns true iff a failure should fire for this call.
 *
 * `rng` defaults to `Math.random`; tests inject a fixed source.
 */
export function rollFailure(
  cfg: FailureConfig | undefined,
  rng: () => number = Math.random,
): boolean {
  if (!cfg) return false;
  if (cfg.rate <= 0) return false;
  if (cfg.rate >= 1) return true;
  return rng() < cfg.rate;
}
