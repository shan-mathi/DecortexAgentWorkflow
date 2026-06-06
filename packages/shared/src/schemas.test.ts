// Smoke tests for shared schemas. Schemas are the contract every other
// package depends on, so the round-trip + rejection cases here exist to
// catch accidental field renames / drift, not to exhaustively test Zod.

import { describe, expect, it } from "vitest";

import {
  EdgeDefSchema,
  NodeDefSchema,
  NodeExecutionSchema,
  NodeResultSchema,
  RunStatusSchema,
  RunTraceSchema,
  WorkflowDefSchema,
} from "./index.js";

describe("WorkflowDefSchema", () => {
  it("accepts a minimal valid workflow", () => {
    const def = {
      name: "ops-ticket-router",
      nodes: [
        {
          id: "classify",
          type: "llm",
          config: { model: "gpt-4o-mini", promptTemplate: "x" },
          position_x: 0,
          position_y: 0,
        },
      ],
      edges: [],
    };
    expect(WorkflowDefSchema.parse(def)).toMatchObject({ name: "ops-ticket-router" });
  });

  it("rejects unknown top-level keys via .strict()", () => {
    const def = {
      name: "x",
      nodes: [
        { id: "a", type: "llm", config: {}, position_x: 0, position_y: 0 },
      ],
      edges: [],
      // Unknown key — should fail.
      hijack: true,
    };
    expect(() => WorkflowDefSchema.parse(def)).toThrow();
  });

  it("rejects an empty node list", () => {
    const def = { name: "x", nodes: [], edges: [] };
    expect(() => WorkflowDefSchema.parse(def)).toThrow();
  });
});

describe("NodeDefSchema / EdgeDefSchema", () => {
  it("requires position_x and position_y", () => {
    expect(() =>
      NodeDefSchema.parse({ id: "a", type: "llm", config: {} }),
    ).toThrow();
  });

  it("accepts a Branch edge with a condition_expression", () => {
    expect(
      EdgeDefSchema.parse({ from: "a", to: "b", condition_expression: "HIGH" }),
    ).toMatchObject({ from: "a", to: "b" });
  });

  it("accepts an edge with omitted condition_expression", () => {
    expect(EdgeDefSchema.parse({ from: "a", to: "b" })).toMatchObject({
      from: "a",
      to: "b",
    });
  });
});

describe("NodeResultSchema", () => {
  it("round-trips a SUCCEEDED result with token usage", () => {
    const r = {
      output: { text: "hi" },
      status: "SUCCEEDED" as const,
      durationMs: 12,
      tokenUsage: { promptTokens: 4, completionTokens: 1 },
    };
    expect(NodeResultSchema.parse(r)).toEqual(r);
  });

  it("rejects negative durationMs", () => {
    expect(() =>
      NodeResultSchema.parse({ output: null, status: "SUCCEEDED", durationMs: -1 }),
    ).toThrow();
  });
});

describe("RunStatusSchema", () => {
  it("only allows the four lifecycle states", () => {
    for (const s of ["PENDING", "RUNNING", "SUCCEEDED", "FAILED"]) {
      expect(RunStatusSchema.parse(s)).toBe(s);
    }
    expect(() => RunStatusSchema.parse("CANCELLED")).toThrow();
  });
});

describe("RunTraceSchema / NodeExecutionSchema", () => {
  it("round-trips meta + node executions", () => {
    const trace = {
      meta: {
        runId: "11111111-1111-4111-8111-111111111111",
        workflowId: "22222222-2222-4222-8222-222222222222",
        status: "SUCCEEDED" as const,
        startedAt: new Date("2026-01-01T00:00:00Z"),
        endedAt: new Date("2026-01-01T00:00:01Z"),
        input: { body: "outage" },
      },
      nodeExecutions: [
        {
          nodeId: "classify",
          input: { body: "outage" },
          output: { text: "HIGH" },
          status: "SUCCEEDED" as const,
          durationMs: 10,
          attemptCount: 1,
          startedAt: new Date("2026-01-01T00:00:00Z"),
          tokenUsage: { promptTokens: 2, completionTokens: 1 },
        },
      ],
    };
    const parsed = RunTraceSchema.parse(trace);
    expect(parsed.nodeExecutions[0]?.nodeId).toBe("classify");
    expect(parsed.meta.endedAt).toBeInstanceOf(Date);
  });

  it("requires attemptCount to be positive", () => {
    expect(() =>
      NodeExecutionSchema.parse({
        nodeId: "x",
        input: null,
        output: null,
        status: "SUCCEEDED",
        durationMs: 0,
        attemptCount: 0,
        startedAt: new Date(),
      }),
    ).toThrow();
  });
});
