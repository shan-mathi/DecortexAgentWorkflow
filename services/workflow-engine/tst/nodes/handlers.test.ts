import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { BranchHandler } from "../../src/nodes/builtins/branch-handler.js";
import { TransformHandler } from "../../src/nodes/builtins/transform-handler.js";
import { LLMHandler } from "../../src/nodes/builtins/llm-handler.js";
import type { NodeContext } from "../../src/types/index.js";

function makeCtx(upstream: NodeContext["upstream"] = {}, runInput: unknown = {}): NodeContext {
  return { runId: "r", nodeId: "n", runInput, upstream, metadata: { workflowId: "w", attempt: 1 } };
}

describe("BranchHandler", () => {
  const handler = new BranchHandler();

  it("returns takenBranch matching the expression", async () => {
    const ctx = makeCtx({ classify: { output: { text: "HIGH" }, status: "SUCCEEDED", durationMs: 0 } });
    const r = await handler.execute(
      { expression: "upper(nodes.classify.text)", branches: { HIGH: "urgent", LOW: "low" }, default: "low" },
      ctx,
    );
    expect(r.status).toBe("SUCCEEDED");
    expect((r.output as { takenBranch: string }).takenBranch).toBe("urgent");
  });

  it("falls through to default when no case matches", async () => {
    const ctx = makeCtx({ classify: { output: { text: "UNKNOWN" }, status: "SUCCEEDED", durationMs: 0 } });
    const r = await handler.execute(
      { expression: "nodes.classify.text", branches: { HIGH: "h" }, default: "fallback" },
      ctx,
    );
    expect((r.output as { takenBranch: string }).takenBranch).toBe("fallback");
  });

  it("returns FAILED when no match and no default", async () => {
    const ctx = makeCtx({ classify: { output: { text: "X" }, status: "SUCCEEDED", durationMs: 0 } });
    const r = await handler.execute(
      { expression: "nodes.classify.text", branches: { HIGH: "h" } },
      ctx,
    );
    expect(r.status).toBe("FAILED");
  });

  it("handles hyphenated nodeIds via underscore alias", async () => {
    const ctx = makeCtx({ "classify-ticket": { output: { text: "MED" }, status: "SUCCEEDED", durationMs: 0 } });
    const r = await handler.execute(
      { expression: "nodes.classify_ticket.text", branches: { MED: "medium" }, default: "other" },
      ctx,
    );
    expect((r.output as { takenBranch: string }).takenBranch).toBe("medium");
  });
});

describe("TransformHandler", () => {
  const handler = new TransformHandler();

  it("evaluates expression and returns result as output", async () => {
    const ctx = makeCtx({ classify: { output: { text: "high" }, status: "SUCCEEDED", durationMs: 0 } });
    const r = await handler.execute({ expression: "upper(nodes.classify.text)" }, ctx);
    expect(r.status).toBe("SUCCEEDED");
    expect(r.output).toBe("HIGH");
  });

  it("can access input bindings", async () => {
    const ctx = makeCtx({}, { count: 5 });
    const r = await handler.execute({ expression: "input.count * 2" }, ctx);
    expect(r.output).toBe(10);
  });

  it("returns FAILED on invalid expression", async () => {
    const r = await handler.execute({ expression: "???" }, makeCtx());
    expect(r.status).toBe("FAILED");
    expect(r.error?.message).toContain("parse");
  });

  it("returns FAILED when expression is empty", async () => {
    const r = await handler.execute({ expression: "" }, makeCtx());
    expect(r.status).toBe("FAILED");
  });
});

describe("LLMHandler (mock mode)", () => {
  const handler = new LLMHandler();

  it("returns HIGH for classify prompts with outage keywords", async () => {
    const ctx = makeCtx({}, { subject: "API down", description: "503" });
    const r = await handler.execute(
      { promptTemplate: "Reply with only the label. Subject: 503 outage down" },
      ctx,
    );
    expect(r.status).toBe("SUCCEEDED");
    expect((r.output as { text: string }).text).toBe("HIGH");
  });

  it("returns LOW for classify prompts without urgency keywords", async () => {
    const ctx = makeCtx({}, { subject: "question", description: "how to export" });
    const r = await handler.execute(
      { promptTemplate: "Reply with only the label. Subject: how to export data" },
      ctx,
    );
    expect(r.status).toBe("SUCCEEDED");
    expect((r.output as { text: string }).text).toBe("LOW");
  });

  it("returns generic text for non-classify prompts", async () => {
    const ctx = makeCtx({}, { subject: "test" });
    const r = await handler.execute(
      { promptTemplate: "Draft a reply for: test" },
      ctx,
    );
    expect(r.status).toBe("SUCCEEDED");
    expect((r.output as { text: string }).text.length).toBeGreaterThan(10);
  });

  it("returns FAILED when promptTemplate is missing", async () => {
    const r = await handler.execute({}, makeCtx());
    expect(r.status).toBe("FAILED");
    expect(r.error?.message).toContain("promptTemplate");
  });

  it("includes token usage", async () => {
    const r = await handler.execute(
      { promptTemplate: "Reply with only the label. Hello world" },
      makeCtx(),
    );
    expect(r.tokenUsage).toBeDefined();
    expect(r.tokenUsage!.promptTokens).toBeGreaterThan(0);
  });
});
