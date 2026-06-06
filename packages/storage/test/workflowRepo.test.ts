// Tests for `WorkflowRepo` — both in-memory and Postgres implementations.
//
// Coverage:
//   - Round-trip create → get returns the same definition.
//   - update → get reflects the change and bumps `version`.
//   - list returns the new workflow.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { WorkflowRepo } from "@workflow-engine/engine";
import type { WorkflowDef } from "@workflow-engine/shared";

import { InMemoryWorkflowRepo } from "../src/inMemoryRepos.js";
import { WorkflowRepoPostgres } from "../src/workflowRepo.js";
import { dockerAvailable, startPg, type PgHarness } from "./testcontainersHelper.js";

// Test both implementations
const implementations = [
  {
    name: "InMemoryWorkflowRepo",
    create: async () => ({ repo: new InMemoryWorkflowRepo() }),
    cleanup: async () => {},
  },
  {
    name: "WorkflowRepoPostgres (testcontainers)",
    create: async () => {
      const harness = await startPg();
      return { repo: new WorkflowRepoPostgres(harness.db), harness };
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
    let harness: PgHarness | undefined;
    let repo: WorkflowRepo;

    beforeAll(async () => {
      const result = await impl.create();
      repo = result.repo;
      harness = result.harness;
    }, 120_000);

    afterAll(async () => {
      await impl.cleanup(harness);
    });

    it("round-trips a workflow via create → get", async () => {
      const def: WorkflowDef = {
        name: "ops-ticket-router",
        nodes: [
          {
            id: "classify",
            type: "llm",
            config: { promptTemplate: "x", model: "gpt-4o-mini" },
            position_x: 0,
            position_y: 0,
          },
          {
            id: "draftLow",
            type: "llm",
            config: { promptTemplate: "y", model: "gpt-4o-mini" },
            position_x: 100,
            position_y: 0,
          },
        ],
        edges: [{ from: "classify", to: "draftLow" }],
      };

      const meta = await repo.create(def);
      expect(meta.version).toBe(1);

      const fetched = await repo.get(meta.id);
      expect(fetched.name).toBe("ops-ticket-router");
      expect(fetched.nodes.map((n) => n.id).sort()).toEqual(["classify", "draftLow"]);
      expect(fetched.edges).toHaveLength(1);
    });

    it("update bumps version and replaces nodes", async () => {
      const created = await repo.create({
        name: "u",
        nodes: [
          {
            id: "a",
            type: "transform",
            config: { expression: "1" },
            position_x: 0,
            position_y: 0,
          },
        ],
        edges: [],
      });

      const updated = await repo.update(created.id, {
        name: "u2",
        nodes: [
          {
            id: "a",
            type: "transform",
            config: { expression: "2" },
            position_x: 50,
            position_y: 0,
          },
          {
            id: "b",
            type: "transform",
            config: { expression: "3" },
            position_x: 100,
            position_y: 0,
          },
        ],
        edges: [{ from: "a", to: "b" }],
      });

      expect(updated.version).toBe(2);
      const got = await repo.get(created.id);
      expect(got.name).toBe("u2");
      expect(got.nodes).toHaveLength(2);
      expect(got.edges).toHaveLength(1);
    });

    it("list returns created workflows", async () => {
      const list = await repo.list();
      expect(list.length).toBeGreaterThanOrEqual(1);
    });
  });
}
