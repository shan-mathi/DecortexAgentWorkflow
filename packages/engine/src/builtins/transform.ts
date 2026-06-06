// Transform node — runs a sandboxed expression and returns the result
// as `output`. Reshape upstream outputs without writing a Lambda.

import { z } from "zod";

import { NonRetryableError } from "../retry.js";
import type { NodeContext, NodeResult } from "@workflow-engine/shared";

import type { NodeExecutor } from "../registry.js";
import { SandboxError, evalExpression } from "../sandbox.js";

export const TransformConfigSchema = z
  .object({
    expression: z.string().min(1),
    terminalOnFailure: z.boolean().optional(),
  })
  .strict();

export type TransformConfig = z.infer<typeof TransformConfigSchema>;

export class TransformNode implements NodeExecutor<TransformConfig> {
  readonly type = "transform";
  readonly displayName = "Transform";
  readonly description = "Reshape upstream outputs with a sandboxed expression.";
  readonly category = "data" as const;
  readonly configSchema = TransformConfigSchema;

  async execute(config: TransformConfig, ctx: NodeContext): Promise<NodeResult> {
    const bindings = buildBindings(ctx);
    let value: unknown;
    try {
      value = evalExpression(config.expression, bindings);
    } catch (e) {
      if (e instanceof SandboxError) throw new NonRetryableError(e);
      throw e;
    }
    return { output: value, status: "SUCCEEDED", durationMs: 0 };
  }
}

function buildBindings(ctx: NodeContext): Record<string, unknown> {
  const nodes: Record<string, unknown> = {};
  for (const [id, r] of Object.entries(ctx.upstream)) {
    nodes[id] = r.output ?? null;
  }
  return { nodes, input: ctx.runInput };
}
