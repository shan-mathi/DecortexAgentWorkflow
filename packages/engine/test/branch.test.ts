// BranchNode plugin-contract + behaviour tests.

import { describe, expect, it } from "vitest";

import { pluginContract } from "../src/testing/pluginContract.js";
import { BranchNode } from "../src/builtins/branch.js";

const node = new BranchNode();

const ctx = (urgency = "HIGH") => ({
  runId: "r",
  nodeId: "branch",
  runInput: {},
  upstream: {
    classify: {
      output: { text: urgency },
      status: "SUCCEEDED" as const,
      durationMs: 0,
    },
  },
  metadata: { workflowId: "w", attempt: 1 },
});

pluginContract({
  name: "BranchNode",
  executor: node,
  validConfig: {
    expression: "nodes.classify.text",
    branches: { HIGH: "high", MED: "high", LOW: "low" },
  },
  invalidConfig: { expression: "" },
  makeContext: () => ctx(),
});

describe("BranchNode behaviour", () => {
  it("returns takenBranch matching the expression value", async () => {
    const cfg = node.configSchema.parse({
      expression: "nodes.classify.text",
      branches: { HIGH: "fetchSimilar", MED: "fetchSimilar", LOW: "draftLow" },
    });
    const r = await node.execute(cfg, ctx("HIGH"));
    expect((r.output as { takenBranch: string }).takenBranch).toBe("fetchSimilar");
  });

  it("falls through to default when no case matches", async () => {
    const cfg = node.configSchema.parse({
      expression: "nodes.classify.text",
      branches: { HIGH: "h" },
      default: "fallback",
    });
    const r = await node.execute(cfg, ctx("OTHER"));
    expect((r.output as { takenBranch: string }).takenBranch).toBe("fallback");
  });

  it("throws when expression is unmatched and no default", async () => {
    const cfg = node.configSchema.parse({
      expression: "nodes.classify.text",
      branches: { HIGH: "h" },
    });
    await expect(node.execute(cfg, ctx("LOW"))).rejects.toThrow();
  });
});
