// Deterministic PRNG used by FakeLLM.embed and the latency sampler.
//
// Same seed string → same stream of `[0, 1)` floats, byte-for-byte across
// machines and Node versions. We derive the 32-bit seed from the first 8
// hex chars of `sha256(seedString)` and feed it to mulberry32, a 32-bit
// state PRNG with good statistical properties for our purposes.
//
// We deliberately do NOT use Math.random() (non-deterministic) or
// seedrandom (extra dep) — this is small enough to own.

import { createHash } from "node:crypto";

/**
 * Returns a function `() => number` that yields successive uniform draws
 * in `[0, 1)` from a stream seeded by `seedString`.
 */
export function seededRng(seedString: string): () => number {
  const hex = createHash("sha256").update(seedString).digest("hex").slice(0, 8);
  let state = parseInt(hex, 16) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
