// Latency distribution sampler for FakeLLM.
//
// Three kinds: `constant` (always `mean` ms), `uniform` ([0, 2*mean) ms),
// `exponential` (mean = `mean` ms via inverse-CDF on a uniform draw).
//
// Sampling is intentionally non-deterministic on its own — load tests
// want jitter — but is driven by a passed-in `rng()`. The unit tests
// inject a fixed RNG to assert bounds; production paths default to
// `Math.random`.

export type LatencyConfig =
  | { kind: "constant"; mean: number }
  | { kind: "uniform"; mean: number }
  | { kind: "exponential"; mean: number };

export function sampleLatencyMs(
  cfg: LatencyConfig | undefined,
  rng: () => number = Math.random,
): number {
  if (!cfg) return 0;
  switch (cfg.kind) {
    case "constant":
      return cfg.mean;
    case "uniform":
      return rng() * cfg.mean * 2;
    case "exponential": {
      // Avoid log(0): clamp the smallest representable u away from 0.
      const u = Math.max(rng(), 1e-12);
      return -Math.log(u) * cfg.mean;
    }
  }
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
