import { describe, expect, it } from "vitest";

import { evalExpression, SandboxError } from "../../src/executor/sandbox.js";

describe("evalExpression — allowed", () => {
  it("evaluates arithmetic", () => {
    expect(evalExpression("2 + 3 * 4", {})).toBe(14);
  });

  it("evaluates comparison + ternary", () => {
    expect(evalExpression('x == "HIGH" ? 1 : 0', { x: "HIGH" })).toBe(1);
  });

  it("evaluates member access", () => {
    expect(evalExpression("nodes.classify.text", { nodes: { classify: { text: "MED" } } })).toBe("MED");
  });

  it("supports upper() helper", () => {
    expect(evalExpression('upper("hello")', {})).toBe("HELLO");
  });

  it("supports lower() helper", () => {
    expect(evalExpression('lower("WORLD")', {})).toBe("world");
  });

  it("supports len() for strings", () => {
    expect(evalExpression('len("abc")', {})).toBe(3);
  });

  it("supports contains()", () => {
    expect(evalExpression('contains(s, "down")', { s: "service is down" })).toBe(true);
    expect(evalExpression('contains(s, "up")', { s: "service is down" })).toBe(false);
  });

  it("supports logical operators", () => {
    expect(evalExpression("a > 5 and b < 10", { a: 6, b: 9 })).toBe(true);
  });
});

describe("evalExpression — denied", () => {
  it("rejects __proto__", () => {
    expect(() => evalExpression("x.__proto__", { x: {} })).toThrow(SandboxError);
  });

  it("rejects constructor", () => {
    expect(() => evalExpression("x.constructor", { x: {} })).toThrow(SandboxError);
  });

  it("rejects eval", () => {
    expect(() => evalExpression("eval('1')", {})).toThrow(SandboxError);
  });

  it("rejects require", () => {
    expect(() => evalExpression("require('fs')", {})).toThrow(SandboxError);
  });

  it("does not reject substrings (e.g. 'contractor' is fine)", () => {
    expect(evalExpression("contractor", { contractor: 42 })).toBe(42);
  });

  it("throws SandboxError on parse failure", () => {
    expect(() => evalExpression("???", {})).toThrow(SandboxError);
  });
});
