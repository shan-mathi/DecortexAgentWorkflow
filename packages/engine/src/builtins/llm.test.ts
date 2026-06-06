// LLMNode plugin-contract tests + a focused happy-path test.

import { describe, expect, it } from "vitest";

import { FakeLLM } from "@workflow-engine/fake-llm";

import { pluginContract } from "../testing/pluginContract.js";
import { LLMConfigSchema, LLMNode } from "./llm.js";

const llm = new FakeLLM();
const node = new LLMNode(llm);

const ctx = () => ({
  runId: "r",
  nodeId: "classify",
  runInput: { body: "service down" },
  upstream: {},
  metadata: { workflowId: "w", attempt: 1 },
});

pluginContract({
  name: "LLMNode",
  executor: node,
  validConfig: {
    promptTemplate: "Classify: {{input.body}}",
    model: "gpt-4o-mini",
  },
  invalidConfig: { promptTemplate: "" }, // empty prompt rejected
  makeContext: ctx,
});

describe("LLMNode happy path", () => {
  it("resolves the template against ctx.runInput and returns text + tokens", async () => {
    const config = LLMConfigSchema.parse({
      promptTemplate: "Classify urgency: {{input.body}}",
      model: "gpt-4o-mini",
    });
    const r = await node.execute(config, ctx());
    expect(r.status).toBe("SUCCEEDED");
    expect((r.output as { text: string }).text).toBeTypeOf("string");
    expect(r.tokenUsage?.promptTokens).toBeGreaterThan(0);
  });
});
