// Sandboxed expression evaluator for `Branch.expression` and
// `Transform.expression`.
//
// We use `expr-eval` because it is parser-only — there is no path to
// `eval`, `Function`, `vm`, `require`, or any host global. Workflow
// authors get arithmetic, comparison, logical, conditional, and member
// access plus a small whitelist of string helpers (`upper`, `lower`,
// `len`, `contains`).
//
// Two layers of defence:
//   1. `Parser` is constructed with the operator allowlist below; any
//      operator we did not opt into (e.g. `assignment`, `fndef`) is
//      rejected at parse time.
//   2. A static "deny token" check rejects expressions that mention
//      `__proto__`, `constructor`, `prototype`, etc. — names that could
//      otherwise leak through `allowMemberAccess`.
//
// `evalExpression` always returns the parser's value (string, number,
// boolean, object, array). `evalBranch` is a thin wrapper that coerces
// the result to a string for the engine's case-lookup.

// expr-eval's typings only cover a numeric subset of its actual return
// type — it returns whatever the expression evaluates to (strings,
// objects, etc.). We re-type the relevant bits as `unknown` to avoid
// lying to consumers.
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { Parser } from "expr-eval";

const DENY = [
  "__proto__",
  "constructor",
  "prototype",
  "globalThis",
  "process",
  "require",
  "import",
  "module",
  "Function",
  "eval",
];

function rejectIfDenied(expr: string): void {
  for (const tok of DENY) {
    // Word-boundary-aware: don't false-positive on substrings inside
    // legitimate identifiers ("contractor" should not match "constructor",
    // but "constructor.x" should).
    const re = new RegExp(`\\b${tok}\\b`);
    if (re.test(expr)) {
      throw new SandboxError(`Disallowed token in expression: ${tok}`);
    }
  }
}

export class SandboxError extends Error {
  override readonly name = "SandboxError";
}

const parser: Parser = new Parser({
  allowMemberAccess: true,
  operators: {
    add: true,
    comparison: true,
    concatenate: true,
    conditional: true,
    divide: true,
    logical: true,
    multiply: true,
    remainder: true,
    subtract: true,
    in: true,
    // Explicitly disabled — these create execution capabilities we don't want.
    assignment: false,
    fndef: false,
  },
});

// String helpers exposed to user expressions. Names match the design.
parser.functions.upper = (s: unknown): string =>
  typeof s === "string" ? s.toUpperCase() : String(s).toUpperCase();
parser.functions.lower = (s: unknown): string =>
  typeof s === "string" ? s.toLowerCase() : String(s).toLowerCase();
parser.functions.len = (s: unknown): number => {
  if (typeof s === "string") return s.length;
  if (Array.isArray(s)) return s.length;
  return 0;
};
parser.functions.contains = (haystack: unknown, needle: unknown): boolean => {
  if (typeof haystack === "string" && typeof needle === "string") {
    return haystack.includes(needle);
  }
  if (Array.isArray(haystack)) return haystack.includes(needle);
  return false;
};

/**
 * Evaluate `expression` against `bindings`.
 *
 * Pre:  `expression` is user-authored and untrusted.
 * Post: returns the value the parser produced. May be any JSON-shaped
 *       value (string, number, boolean, object, array).
 *
 * Throws `SandboxError` for parse errors or denied tokens. The caller
 * (Branch or Transform node) is responsible for handling that error
 * shape — typically the wrapper marks the node FAILED.
 */
export function evalExpression(
  expression: string,
  bindings: Record<string, unknown>,
): unknown {
  rejectIfDenied(expression);
  let parsed;
  try {
    parsed = parser.parse(expression);
  } catch (e) {
    throw new SandboxError(
      `Failed to parse expression: ${(e as Error).message}`,
    );
  }
  try {
    // The expr-eval typings claim `number` but the runtime returns the
    // actual value — that's why we re-type as `unknown` here.
    return parsed.evaluate(bindings as never) as unknown;
  } catch (e) {
    throw new SandboxError(
      `Failed to evaluate expression: ${(e as Error).message}`,
    );
  }
}
