// Deterministic retrieval-pipeline test (Task 8.4 / Requirement 10.4).
//
// What this test buys: it proves the entire retrieval pipeline —
// embedding generation, pgvector cosine query, top-K ordering — works
// correctly, deterministically, with no real LLM and no flakiness.
// Runs on every commit (uses mock when Docker is unavailable, real
// Postgres when available).
//
// Mechanism: FakeLLM produces a deterministic vector for any given
// text. We seed `tickets_seed` with the fixture corpus and run the
// `kb-retrieval` node with the *exact text of one of the seeded
// rows* as the query. Cosine distance from a vector to itself is 0
// (similarity 1.0), so the matching row must be returned first.
//
// We don't assert on full top-K ordering of unrelated rows — random
// vectors have no semantic meaning — but the "self-similarity"
// property is enough to prove the pipeline plumbing is correct.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FakeLLM } from "@workflow-engine/fake-llm";
import { KnowledgeBaseRetrievalNode, type QueryRunner } from "@workflow-engine/engine";

import { dockerAvailable, startPg, type PgHarness } from "./testcontainersHelper.js";
import { createMockQueryRunner, MockVectorStore } from "./mockQueryRunner.js";

interface Ticket {
  id: string;
  subject: string;
  body: string;
  resolution: string;
  urgency: string;
}

const runIntegration = dockerAvailable();

describe("kb-retrieval pipeline", () => {
  let harness: PgHarness | undefined;
  let llm: FakeLLM;
  let runner: QueryRunner;
  let mockVectorStore: MockVectorStore | undefined;

  const fixturePath = fileURLToPath(
    new URL("../../../fixtures/tickets/seed.json", import.meta.url),
  );
  const corpus: Ticket[] = JSON.parse(readFileSync(fixturePath, "utf8"));

  beforeAll(async () => {
    llm = new FakeLLM({ embeddingDim: 1536 });

    if (runIntegration) {
      // Docker available: use real Postgres
      harness = await startPg();

      for (const t of corpus) {
        const { vector } = await llm.embed({ text: `${t.subject}\n${t.body}` });
        const vec = `[${vector.join(",")}]`;
        await harness.pool.query(
          `INSERT INTO tickets_seed (id, subject, body, resolution, urgency, embedding)
           VALUES ($1, $2, $3, $4, $5, $6::vector)`,
          [t.id, t.subject, t.body, t.resolution, t.urgency, vec],
        );
      }

      runner = {
        query: async (sql, params) => {
          const r = await harness!.pool.query(sql, params);
          return { rows: r.rows };
        },
      };
    } else {
      // No Docker: use mock in-memory vector store
      mockVectorStore = new MockVectorStore();

      for (const t of corpus) {
        const { vector } = await llm.embed({ text: `${t.subject}\n${t.body}` });
        await mockVectorStore.insert({
          id: t.id,
          subject: t.subject,
          body: t.body,
          resolution: t.resolution,
          urgency: t.urgency,
          embedding: vector,
        });
      }

      runner = createMockQueryRunner(mockVectorStore);
    }
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
    mockVectorStore?.clear();
  });

  it("retrieves the corpus row with the exact same text as the top match", async () => {
    const target = corpus[0]!;
    const queryText = `${target.subject}\n${target.body}`;

    const node = new KnowledgeBaseRetrievalNode(runner, llm);
    const cfg = node.configSchema.parse({
      knowledgeBase: "tickets",
      queryTemplate: "{{input.subject}}\n{{input.body}}",
      topK: 3,
    });
    const r = await node.execute(cfg, {
      runId: "r",
      nodeId: "fetchSimilar",
      runInput: { subject: target.subject, body: target.body },
      upstream: {},
      metadata: { workflowId: "w", attempt: 1 },
    });

    const out = r.output as { documents: Array<{ id: string; similarity: number }> };
    expect(out.documents).toHaveLength(3);
    expect(out.documents[0]?.id).toBe(target.id);
    // Self-similarity should be ~1.0 (cosine sim of normalised vec with itself).
    expect(out.documents[0]?.similarity).toBeGreaterThan(0.999);
    expect(r.tokenUsage?.promptTokens).toBeGreaterThan(0);

    void queryText; // for parity with seed-tickets script — easier to debug.
  });
});
