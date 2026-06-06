// Generic plugin-contract test suite, parameterised over a
// `NodeExecutor`. Every built-in node and every user plugin MUST pass
// this suite.
//
// What it asserts:
//   1. `configSchema.parse` rejects clearly invalid configs.
//   2. `execute` returns a well-formed `NodeResult` for at least one
//      happy-path config.
//   3. Errors thrown by `execute` surface as `status: "FAILED"` when
//      wrapped by `runNodeWithRetry` (rather than unhandled rejection).
//
// Authors call `pluginContract({ executor, validConfig, invalidConfig,
// makeContext, throwingExecutor })` from a vitest file. The suite runs
// inside a `describe(...)` block so each contract test shows up under
// the parent file.

import { describe, expect, it } from "vitest";

import type { NodeContext, NodeResult } from "@workflow-engine/shared";

import { type NodeExecutor } from "../registry.js";
import { runNodeWithRetry } from "../retry.js";

export interface PluginContractCase {
  /** Display name used in the `describe(...)` block. */
  name: string;
  /** The executor under test. */
  executor: NodeExecutor;
  /** A config the schema MUST accept. */
  validConfig: unknown;
  /** A config the schema MUST reject. */
  invalidConfig: unknown;
  /** Builder for a `NodeContext` plausible for this executor. */
  makeContext: () => NodeContext;
  /**
   * Optional: an executor that throws on `execute` so we can prove the
   * retry wrapper turns that into `status: FAILED`. If omitted, we
   * synthesise one with the same `type` and `configSchema`.
   */
  throwingExecutor?: NodeExecutor;
}

export function pluginContract(opts: PluginContractCase): void {
  describe(`pluginContract: ${opts.name}`, () => {
    it("configSchema rejects invalid configs", () => {
      const r = opts.executor.configSchema.safeParse(opts.invalidConfig);
      expect(r.success).toBe(false);
    });

    it("configSchema accepts the happy-path config", () => {
      const r = opts.executor.configSchema.safeParse(opts.validConfig);
      expect(r.success).toBe(true);
    });

    it("execute returns a well-formed NodeResult on happy path", async () => {
      const config = opts.executor.configSchema.parse(opts.validConfig);
      const ctx = opts.makeContext();
      const result: NodeResult = await opts.executor.execute(config, ctx);
      expect(result).toBeDefined();
      expect(result.status).toMatch(/SUCCEEDED|FAILED|SKIPPED/);
      expect(typeof result.durationMs).toBe("number");
    });

    it("thrown errors surface as status FAILED via runNodeWithRetry", async () => {
      const throwing: NodeExecutor =
        opts.throwingExecutor ?? {
          ...opts.executor,
          execute: async () => {
            throw new Error("simulated failure");
          },
        };
      const node = {
        id: "n",
        type: opts.executor.type,
        config: { ...(opts.validConfig as Record<string, unknown>), retry: { maxAttempts: 1, backoffMs: 0, jitter: 0 } },
        position_x: 0,
        position_y: 0,
      };
      const r = await runNodeWithRetry(node, throwing, opts.makeContext(), {
        sleep: () => Promise.resolve(),
      });
      expect(r.status).toBe("FAILED");
      expect(r.error?.message).toBeDefined();
    });
  });
}
