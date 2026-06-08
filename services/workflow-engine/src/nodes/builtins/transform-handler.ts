// Transform Node Handler — runs a small JS/TS expression (or pure
// function) on prior outputs to reshape data.
//
// The expression has access to:
//   - `nodes.<nodeId>.<field>` — output of any upstream node
//   - `input.<field>` — the original run input
//
// Built-in functions: upper(), lower(), len(), contains()
//
// The handler evaluates the expression via a sandboxed parser
// (expr-eval) — no eval/vm/Function. The result becomes the node's
// output, available to downstream nodes.
//
// Examples:
//   "nodes.classify.text"                     → passes through a field
//   "upper(nodes.classify.text)"              → transforms a string
//   "nodes.fetch.documents.length"            → counts results
//   "input.subject + ' - ' + input.body"      → concatenates fields

import type { NodeContext, NodeResult } from "../../types/index.js";

import { evalExpression, SandboxError } from "../../executor/sandbox.js";
import type { NodeHandler } from "../node-handler.js";

interface TransformConfig {
  expression: string;
}

export class TransformHandler implements NodeHandler {
  readonly category = "transform";

  async execute(config: unknown, ctx: NodeContext): Promise<NodeResult> {
    const cfg = config as TransformConfig;

    if (!cfg.expression) {
      return {
        output: null,
        status: "FAILED",
        durationMs: 0,
        error: { message: "Transform node requires an expression in config." },
      };
    }

    const bindings = buildBindings(ctx);
    let value: unknown;
    try {
      value = evalExpression(cfg.expression, bindings);
    } catch (e) {
      if (e instanceof SandboxError) {
        return {
          output: null,
          status: "FAILED",
          durationMs: 0,
          error: { message: e.message },
        };
      }
      throw e;
    }

    return { output: value, status: "SUCCEEDED", durationMs: 0 };
  }
}

function buildBindings(ctx: NodeContext): Record<string, unknown> {
  const nodes: Record<string, unknown> = {};
  for (const [id, r] of Object.entries(ctx.upstream)) {
    nodes[id] = r.output ?? null;
    // Also expose with underscores so hyphenated nodeIds are accessible
    // in expr-eval (hyphens aren't valid identifiers in expressions).
    const normalized = id.replace(/-/g, "_");
    if (normalized !== id) nodes[normalized] = r.output ?? null;
  }
  return { nodes, input: ctx.runInput };
}
