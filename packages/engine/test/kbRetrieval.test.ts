// kb-retrieval plugin-contract test using a fake QueryRunner so the
// engine package's tests don't need Postgres. The deterministic
// retrieval-pipeline test against a real container lives in
// `packages/storage/test/` (Task 8.4).

import { describe, expect, it } from "vitest";

import { FakeLLM } from "@workflow-engine/fake-llm";

import { pluginContract } from "../src/testing/pluginContract.js";
import { KnowledgeBaseRetrievalNode, type QueryRunner } from "../src/plugins/kbRetrieval.js";

const fakeDb: QueryRunner = {
  async query() {
    return {
      rows: [
        { id: "t1", subject: "auth broken", resolution: "reset cache", urgency: "HIGH", similarity: 0.95 },
        { id: "t2", subject: "login flaky", resolution: "scale", urgency: "MED", similarity: 0.91 },
        { id: "t3", subject: "session drop", resolution: "rotate", urgency: "MED", similarity: 0.83 },
      ],
    };
  },
};

const node = new KnowledgeBaseRetrievalNode(fakeDb, new FakeLLM({ embeddingDim: 16 }));

const ctx = () => ({
  runId: "r",
  nodeId: "fetchSimilar",
  runInput: { subject: "auth broken", body: "service down" },
  upstream: {},
  metadata: { workflowId: "w", attempt: 1 },
});

pluginContract({
  name: "KnowledgeBaseRetrievalNode",
  executor: node,
  validConfig: {
    knowledgeBase: "tickets",
    queryTemplate: "{{input.subject}} {{input.body}}",
    topK: 3,
  },
  invalidConfig: { knowledgeBase: "wrong-kb", queryTemplate: "x" },
  makeContext: ctx,
});

describe("KnowledgeBaseRetrievalNode behaviour", () => {
  it("returns documents and attributes embedding tokenUsage", async () => {
    const cfg = node.configSchema.parse({
      knowledgeBase: "tickets",
      queryTemplate: "{{input.subject}} {{input.body}}",
      topK: 3,
    });
    const r = await node.execute(cfg, ctx());
    expect(r.status).toBe("SUCCEEDED");
    const out = r.output as { documents: unknown[] };
    expect(out.documents).toHaveLength(3);
    expect(r.tokenUsage?.promptTokens).toBeGreaterThan(0);
    expect(r.tokenUsage?.completionTokens).toBe(0);
  });
});
