// Sandbox tests. Two halves:
//   - allowed expressions evaluate to the right values
//   - disallowed tokens are rejected at parse time, before evaluation

import { describe, expect, it } from "vitest";

import { SandboxError, evalExpression } from "./sandbox.js";

describe("evalExpression — allowed", () => {
  it("evaluates arithmetic", () => {
    expect(evalExpression("2 + 3 * 4", {})).toBe(14);
  });

  it("evaluates comparison + ternary", () => {
    expect(
      evalExpression("urgency == \"HIGH\" ? 1 : 0", { urgency: "HIGH" }),
    ).toBe(1);
  });

  it("evaluates member access on bound objects", () => {
    expect(
      evalExpression("nodes.classify.text", {
        nodes: { classify: { text: "HIGH" } },
      }),
    ).toBe("HIGH");
  });

  it("supports the registered string helpers", () => {
    expect(evalExpression("upper(\"hi\")", {})).toBe("HI");
    expect(evalExpression("len(\"abc\")", {})).toBe(3);
    expect(
      evalExpression('contains(s, "down")', { s: "service is down" }),
    ).toBe(true);
  });
});

describe("evalExpression — denied", () => {
  it("rejects __proto__ access", () => {
    expect(() => evalExpression("x.__proto__", { x: {} })).toThrow(SandboxError);
  });

  it("rejects constructor access", () => {
    expect(() => evalExpression("x.constructor", { x: {} })).toThrow(
      SandboxError,
    );
  });

  it("rejects assignment", () => {
    expect(() => evalExpression("x = 5", {})).toThrow(SandboxError);
  });

  it("rejects function definition", () => {
    expect(() => evalExpression("f(x) = x + 1", {})).toThrow(SandboxError);
  });

  it("does not match identifiers that merely contain a denied substring", () => {
    expect(evalExpression("contractor", { contractor: 1 })).toBe(1);
  });
});
