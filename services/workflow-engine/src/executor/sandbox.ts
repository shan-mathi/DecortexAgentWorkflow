// Sandboxed expression evaluator for Branch and Transform nodes.
// Uses expr-eval (parser-only, no eval/vm/Function).
// Ported from packages/engine/src/sandbox.ts — same logic.

import { Parser } from "expr-eval";

const DENY = ["__proto__", "constructor", "prototype", "globalThis", "process", "require", "import", "module", "Function", "eval"];

export class SandboxError extends Error {
  override readonly name = "SandboxError";
}

function rejectIfDenied(expr: string): void {
  for (const tok of DENY) {
    if (new RegExp(`\\b${tok}\\b`).test(expr)) {
      throw new SandboxError(`Disallowed token in expression: ${tok}`);
    }
  }
}

const parser: Parser = new Parser({
  allowMemberAccess: true,
  operators: {
    add: true, comparison: true, concatenate: true, conditional: true,
    divide: true, logical: true, multiply: true, remainder: true,
    subtract: true, in: true, assignment: false, fndef: false,
  },
});

parser.functions.upper = (s: unknown): string => String(s).toUpperCase();
parser.functions.lower = (s: unknown): string => String(s).toLowerCase();
parser.functions.len = (s: unknown): number => {
  if (typeof s === "string") return s.length;
  if (Array.isArray(s)) return s.length;
  return 0;
};
parser.functions.contains = (haystack: unknown, needle: unknown): boolean => {
  if (typeof haystack === "string" && typeof needle === "string") return haystack.includes(needle);
  if (Array.isArray(haystack)) return haystack.includes(needle);
  return false;
};

export function evalExpression(expression: string, bindings: Record<string, unknown>): unknown {
  rejectIfDenied(expression);
  let parsed;
  try {
    parsed = parser.parse(expression);
  } catch (e) {
    throw new SandboxError(`Failed to parse expression: ${(e as Error).message}`);
  }
  try {
    return parsed.evaluate(bindings as never) as unknown;
  } catch (e) {
    throw new SandboxError(`Failed to evaluate expression: ${(e as Error).message}`);
  }
}
