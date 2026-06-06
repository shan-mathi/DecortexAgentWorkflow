// Template substitution for `{{nodeId.path}}` and `{{input.path}}`.
//
// Used by:
//   - LLMNode.promptTemplate    → "Classify: {{input.body}}"
//   - HTTPNode.url / bodyTemplate
//   - KnowledgeBaseRetrievalNode.queryTemplate
//
// Resolution rules:
//   - `{{input.path.to.field}}`       → walks `ctx.runInput`
//   - `{{nodeId.path.to.field}}`      → walks `ctx.upstream[nodeId].output`
//   - non-string scalar values       → `JSON.stringify(value)`
//   - missing reference at any depth → throws `TemplateError(ref, path)`
//
// Whitespace inside the braces is tolerated; nested templates are not.
// Path segments are split on dots. Numeric indices into arrays use
// dotted indices: `{{fetchSimilar.documents.0.id}}` (matches the
// JSON-pointer style used elsewhere in the trace).

import type { NodeContext, NodeResult } from "@workflow-engine/shared";

export class TemplateError extends Error {
  constructor(
    public readonly ref: string,
    public readonly path: string[],
    message?: string,
  ) {
    super(
      message ??
        `Template reference "${ref}" — missing path segment "${path.join(".")}".`,
    );
    this.name = "TemplateError";
  }
}

const PATTERN = /\{\{\s*([^}]+?)\s*\}\}/g;

/**
 * Substitute every `{{...}}` placeholder in `template` against `ctx`.
 *
 * Strings are inserted raw; non-string JSON values (numbers, booleans,
 * objects, arrays) are JSON-stringified so that the output of templating
 * is always a string.
 *
 * Throws `TemplateError` on the first missing reference encountered;
 * partial substitution is never returned (a half-resolved prompt is
 * worse than a clear error).
 */
export function resolveTemplate(template: string, ctx: NodeContext): string {
  return template.replace(PATTERN, (_, expr: string) => {
    const path = expr.trim().split(".");
    const root = path[0];
    if (root == null || root.length === 0) {
      throw new TemplateError(expr, path, `Template reference "${expr}" is empty.`);
    }
    const rest = path.slice(1);
    const value = root === "input" ? walk(ctx.runInput, rest) : walkNode(ctx.upstream, root, rest);
    return stringify(value);
  });
}

function walkNode(
  upstream: Record<string, NodeResult>,
  nodeId: string,
  path: string[],
): unknown {
  const result = upstream[nodeId];
  if (!result) {
    throw new TemplateError(nodeId, [nodeId, ...path], `Template references unknown node "${nodeId}".`);
  }
  return walk(result.output, path);
}

function walk(root: unknown, path: string[]): unknown {
  let cur: unknown = root;
  const traversed: string[] = [];
  for (const seg of path) {
    traversed.push(seg);
    if (cur == null || typeof cur !== "object") {
      throw new TemplateError(seg, traversed);
    }
    if (Array.isArray(cur)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) {
        throw new TemplateError(seg, traversed);
      }
      cur = cur[idx];
    } else {
      const obj = cur as Record<string, unknown>;
      if (!(seg in obj)) {
        throw new TemplateError(seg, traversed);
      }
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
