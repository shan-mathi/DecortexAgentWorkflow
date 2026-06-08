// Branch Node Handler — routes execution based on expression evaluation.

import type { NodeContext, NodeResult } from "../../types/index.js";

import { evalExpression, SandboxError } from "../../executor/sandbox.js";
import type { NodeHandler } from "../node-handler.js";

interface BranchConfig {
  expression: string;
  branches: Record<string, string>;
  default?: string;
}

export class BranchHandler implements NodeHandler {
  readonly category = "branch";

  async execute(config: unknown, ctx: NodeContext): Promise<NodeResult> {
    const cfg = config as BranchConfig;
    const bindings = buildBindings(ctx);

    let value: unknown;
    try {
      value = evalExpression(cfg.expression, bindings);
    } catch (e) {
      if (e instanceof SandboxError) {
        return { output: null, status: "FAILED", durationMs: 0, error: { message: e.message } };
      }
      throw e;
    }

    const key = String(value);
    const taken = cfg.branches[key] ?? cfg.default;
    if (!taken) {
      return {
        output: null,
        status: "FAILED",
        durationMs: 0,
        error: { message: `Branch expression evaluated to "${key}" which has no matching branch and no default.` },
      };
    }

    return { output: { takenBranch: taken, value: key }, status: "SUCCEEDED", durationMs: 0 };
  }
}

function buildBindings(ctx: NodeContext): Record<string, unknown> {
  const nodes: Record<string, unknown> = {};
  for (const [id, r] of Object.entries(ctx.upstream)) {
    nodes[id] = r.output ?? null;
    const normalized = id.replace(/-/g, "_");
    if (normalized !== id) nodes[normalized] = r.output ?? null;
  }
  return { nodes, input: ctx.runInput };
}
