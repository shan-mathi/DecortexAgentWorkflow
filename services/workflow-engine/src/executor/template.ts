// Template resolution: substitutes {{nodeId.path}} and {{input.path}}
// in prompt templates, URLs, etc.
// Ported from packages/engine/src/template.ts — same logic.

import type { NodeContext, NodeResult } from "../types/index.js";

export class TemplateError extends Error {
  constructor(
    public readonly ref: string,
    public readonly path: string[],
    message?: string,
  ) {
    super(message ?? `Template reference "${ref}" — missing path segment "${path.join(".")}".`);
    this.name = "TemplateError";
  }
}

const PATTERN = /\{\{\s*([^}]+?)\s*\}\}/g;

export function resolveTemplate(template: string, ctx: NodeContext): string {
  return template.replace(PATTERN, (_, expr: string) => {
    const path = expr.trim().split(".");
    const root = path[0];
    if (!root || root.length === 0) throw new TemplateError(expr, path, `Empty reference.`);
    const rest = path.slice(1);
    const value = root === "input" ? walk(ctx.runInput, rest) : walkNode(ctx.upstream, root, rest);
    return stringify(value);
  });
}

function walkNode(upstream: Record<string, NodeResult>, nodeId: string, path: string[]): unknown {
  const result = upstream[nodeId];
  if (!result) throw new TemplateError(nodeId, [nodeId, ...path], `Unknown node "${nodeId}".`);
  return walk(result.output, path);
}

function walk(root: unknown, path: string[]): unknown {
  let cur: unknown = root;
  const traversed: string[] = [];
  for (const seg of path) {
    traversed.push(seg);
    if (cur == null || typeof cur !== "object") throw new TemplateError(seg, traversed);
    if (Array.isArray(cur)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) throw new TemplateError(seg, traversed);
      cur = cur[idx];
    } else {
      const obj = cur as Record<string, unknown>;
      if (!(seg in obj)) throw new TemplateError(seg, traversed);
      cur = obj[seg];
    }
  }
  return cur;
}

function stringify(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return String(v);
  return JSON.stringify(v);
}
