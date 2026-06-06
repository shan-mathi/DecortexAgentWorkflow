// Branch node — evaluates a sandboxed expression against `ctx.upstream`
// and `ctx.runInput`, then maps the result to a target node id via the
// `branches` table.
//
// The output `{ takenBranch }` is read by `runWorkflow` to mark the
// non-taken downstream subtrees as SKIPPED.
//
// Expression bindings:
//   - `nodes.<id>.<field>` — output of an upstream node
//   - `input.<field>`      — top-level run input
//
// Helpers available: `upper`, `lower`, `len`, `contains` (see sandbox).

import { z } from "zod";

import { NonRetryableError } from "../retry.js";
import type { NodeContext, NodeResult } from "@workflow-engine/shared";

import type { NodeExecutor } from "../registry.js";
import { SandboxError, evalExpression } from "../sandbox.js";

export const BranchConfigSchema = z
  .object({
    expression: z.string().min(1),
    branches: z.record(z.string(), z.string()),
    /** Target chosen when the expression result is not in `branches`. */
    default: z.string().optional(),
    terminalOnFailure: z.boolean().optional(),
  })
  .strict();

export type BranchConfig = z.infer<typeof BranchConfigSchema>;

export class BranchNode implements NodeExecutor<BranchConfig> {
  readonly type = "branch";
  readonly displayName = "Branch";
  readonly description = "Route execution by evaluating an expression over upstream outputs.";
  readonly category = "control" as const;
  readonly configSchema = BranchConfigSchema;

  async execute(config: BranchConfig, ctx: NodeContext): Promise<NodeResult> {
    const bindings = buildBindings(ctx);
    let value: unknown;
    try {
      value = evalExpression(config.expression, bindings);
    } catch (e) {
      if (e instanceof SandboxError) throw new NonRetryableError(e);
      throw e;
    }
    const key = String(value);
    const taken = config.branches[key] ?? config.default;
    if (!taken) {
      throw new NonRetryableError(
        new Error(
          `Branch expression evaluated to "${key}" which has no matching branch and no default.`,
        ),
      );
    }
    return {
      output: { takenBranch: taken, value: key },
      status: "SUCCEEDED",
      durationMs: 0,
    };
  }
}

function buildBindings(ctx: NodeContext): Record<string, unknown> {
  const nodes: Record<string, unknown> = {};
  for (const [id, r] of Object.entries(ctx.upstream)) {
    nodes[id] = r.output ?? null;
  }
  return { nodes, input: ctx.runInput };
}
