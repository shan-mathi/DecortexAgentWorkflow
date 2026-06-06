// Tests for `RunRepo` — both in-memory and Postgres implementations.
//
// Coverage:
//   - createRun + setRunStatus + appendNodeExecution → getRun returns
//     the full trace in one read.
//   - appendNodeExecution is idempotent on (runId, nodeId).
//   - listRuns is ordered by startedAt.

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { RunRepo } from "@workflow-engine/engine";
import type { NodeExecution } from "@workflow-engine/shared";

import { InMemoryRunRepo } from "../src/inMemoryRepos.js";
import { RunRepoPostgres } from "../src/runRepo.js";
import { dockerAvailable, startPg, type PgHarness } from "./testcontainersHelper.js";

// Test both implementations
const implementations = [
  {
    name: "InMemoryRunRepo",
    create: async () => ({ repo: new InMemoryRunRepo() }),
    cleanup: async () => {},
  },
  {
    name: "RunRepoPostgres (testcontainers)",
    create: async () => {
      const harness = await startPg();
      return { repo: new RunRepoPostgres(harness.db), harness };
    },
    cleanup: async (harness?: PgHarness) => {
      await harness?.stop();
    },
    skipIf: !dockerAvailable(),
  },
];

for (const impl of implementations) {
  const d = impl.skipIf ? describe.skip : describe;

  d(impl.name, () => {
    let repo: RunRepo;
    let harness: PgHarness | undefined;
    const workflowId = "11111111-1111-4111-8111-111111111111";

    beforeAll(async () => {
      const result = await impl.create();
      repo = result.repo;
      harness = result.harness;
    }, 120_000);

    afterAll(async () => {
      await impl.cleanup(harness);
    });

    it("round-trips a run trace", async () => {
      const runId = randomUUID();
      await repo.createRun({ runId, workflowId, input: { x: 1 } });
      await repo.setRunStatus(runId, "RUNNING");

      const ne: NodeExecution = {
        nodeId: "classify",
        input: { body: "outage" },
        output: { text: "HIGH" },
        status: "SUCCEEDED",
        durationMs: 10,
        attemptCount: 1,
        startedAt: new Date(),
        tokenUsage: { promptTokens: 4, completionTokens: 1 },
      };
      await repo.appendNodeExecution(runId, ne);
      await repo.setRunStatus(runId, "SUCCEEDED", new Date());

      const trace = await repo.getRun(runId);
      expect(trace.meta.status).toBe("SUCCEEDED");
      expect(trace.meta.endedAt).toBeInstanceOf(Date);
      expect(trace.nodeExecutions).toHaveLength(1);
      expect(trace.nodeExecutions[0]?.nodeId).toBe("classify");
      expect(trace.nodeExecutions[0]?.tokenUsage?.promptTokens).toBe(4);
    });

    it("appendNodeExecution is idempotent on (runId, nodeId)", async () => {
      const runId = randomUUID();
      await repo.createRun({ runId, workflowId, input: null });
      const ne: NodeExecution = {
        nodeId: "x",
        input: null,
        output: 1,
        status: "SUCCEEDED",
        durationMs: 1,
        attemptCount: 1,
        startedAt: new Date(),
      };
      await repo.appendNodeExecution(runId, ne);
      // Second write with different output: should be a silent no-op.
      await repo.appendNodeExecution(runId, { ...ne, output: 999, durationMs: 999 });
      const trace = await repo.getRun(runId);
      expect(trace.nodeExecutions).toHaveLength(1);
      expect(trace.nodeExecutions[0]?.output).toBe(1);
    });

    it("listRuns orders by startedAt ascending", async () => {
      const w = "22222222-2222-4222-8222-222222222222";
      const a = randomUUID();
      const b = randomUUID();
      await repo.createRun({ runId: a, workflowId: w, input: null });
      await new Promise((r) => setTimeout(r, 5));
      await repo.createRun({ runId: b, workflowId: w, input: null });
      const list = await repo.listRuns(w);
      const ids = list.map((s) => s.runId);
      expect(ids[0]).toBe(a);
      expect(ids[1]).toBe(b);
    });
  });
}
