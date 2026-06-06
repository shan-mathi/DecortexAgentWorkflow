// TransformNode plugin-contract + behaviour tests.

import { describe, expect, it } from "vitest";

import { pluginContract } from "../src/testing/pluginContract.js";
import { TransformNode } from "../src/builtins/transform.js";

const node = new TransformNode();

const ctx = () => ({
  runId: "r",
  nodeId: "transform",
  runInput: { count: 5 },
  upstream: {
    classify: {
      output: { text: "HIGH" },
      status: "SUCCEEDED" as const,
      durationMs: 0,
    },
  },
  metadata: { workflowId: "w", attempt: 1 },
});

pluginContract({
  name: "TransformNode",
  executor: node,
  validConfig: { expression: "upper(nodes.classify.text)" },
  invalidConfig: { expression: "" },
  makeContext: ctx,
});

describe("TransformNode behaviour", () => {
  it("evaluates the expression against bindings", async () => {
    const cfg = node.configSchema.parse({
      expression: "upper(nodes.classify.text)",
    });
    const r = await node.execute(cfg, ctx());
    expect(r.output).toBe("HIGH");
  });

  it("can use input.* bindings", async () => {
    const cfg = node.configSchema.parse({ expression: "input.count * 2" });
    const r = await node.execute(cfg, ctx());
    expect(r.output).toBe(10);
  });
});
