// NodeRegistry tests — the contract is small enough that the whole
// surface fits in one file.

import { z } from "zod";

import { describe, expect, it } from "vitest";

import { NodeRegistry, UnknownNodeTypeError, type NodeExecutor } from "../src/registry.js";

function fakeExecutor(type: string): NodeExecutor {
  return {
    type,
    configSchema: z.unknown(),
    execute: async () => ({ output: null, status: "SUCCEEDED", durationMs: 0 }),
  };
}

describe("NodeRegistry", () => {
  it("registers and retrieves an executor by type", () => {
    const r = new NodeRegistry();
    const e = fakeExecutor("llm");
    r.register(e);
    expect(r.get("llm")).toBe(e);
    expect(r.has("llm")).toBe(true);
  });

  it("throws UnknownNodeTypeError on unknown lookup", () => {
    const r = new NodeRegistry();
    expect(() => r.get("missing")).toThrow(UnknownNodeTypeError);
  });

  it("rejects duplicate registration", () => {
    const r = new NodeRegistry();
    r.register(fakeExecutor("llm"));
    expect(() => r.register(fakeExecutor("llm"))).toThrow(/already registered/);
  });

  it("list() returns metadata for every registered type", () => {
    const r = new NodeRegistry();
    r.register({ ...fakeExecutor("llm"), category: "ai", displayName: "LLM" });
    r.register({ ...fakeExecutor("http"), category: "io" });
    const out = r.list();
    expect(out).toHaveLength(2);
    expect(out.find((x) => x.type === "llm")?.displayName).toBe("LLM");
    expect(out.find((x) => x.type === "http")?.category).toBe("io");
  });
});
