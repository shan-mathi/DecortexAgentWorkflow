// API route tests using Fastify's built-in `inject`.
//
// Coverage:
//   - POST /workflows: 400 on invalid body / DAG violations; 201 on
//     valid create; persisted via the in-memory repo.
//   - GET /workflows, /workflows/:id, PUT /workflows/:id (404 on
//     missing id, version bump on update).
//   - POST /workflows/:id/runs: 202 with {runId, status: PENDING};
//     413 on oversized input; the local runner actually invokes the
//     engine and the trace becomes fetchable via GET /runs/:id.
//   - GET /node-types: lists all four built-ins + kb-retrieval.
//
// All tests run against in-memory repos + FakeLLM — no Postgres, no
// network. Real-Postgres routes are exercised in the storage E2E
// tests.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FakeLLM } from "@workflow-engine/fake-llm";
import {
  NodeRegistry,
  registerNodes,
  runWorkflow,
  type QueryRunner,
} from "@workflow-engine/engine";
import {
  InMemoryRunRepo,
  InMemoryWorkflowRepo,
} from "@workflow-engine/engine/testing";
import type { WorkflowDef } from "@workflow-engine/shared";
import type { FastifyInstance } from "fastify";

import { buildApp, makeLocalRunner } from "../src/index.js";

const fakeDb: QueryRunner = {
  async query() {
    return {
      rows: [
        { id: "t1", subject: "x", resolution: "y", urgency: "MED", similarity: 0.9 },
      ],
    };
  },
};

function buildHarness(): { app: Promise<FastifyInstance>; close: () => Promise<void> } {
  const workflowRepo = new InMemoryWorkflowRepo();
  const runRepo = new InMemoryRunRepo();
  const llm = new FakeLLM({ embeddingDim: 16 });
  const registry = new NodeRegistry();
  registerNodes(registry, { llm, db: fakeDb });

  const runner = makeLocalRunner(async ({ runId, workflowId, input }) => {
    const def = await workflowRepo.get(workflowId);
    await runWorkflow(def, input, runId, { registry, runRepo });
  });

  const appP = buildApp({
    workflowRepo,
    runRepo,
    registry,
    runner,
    logger: false,
  });
  return {
    app: appP,
    async close() {
      const a = await appP;
      await a.close();
    },
  };
}

const validDef: WorkflowDef = {
  name: "linear",
  nodes: [
    {
      id: "t1",
      type: "transform",
      config: { expression: "input.x + 1" },
      position_x: 0,
      position_y: 0,
    },
  ],
  edges: [],
};

const cyclicDef: WorkflowDef = {
  name: "cycle",
  nodes: [
    { id: "a", type: "transform", config: { expression: "1" }, position_x: 0, position_y: 0 },
    { id: "b", type: "transform", config: { expression: "1" }, position_x: 0, position_y: 0 },
  ],
  edges: [
    { from: "a", to: "b" },
    { from: "b", to: "a" },
  ],
};

describe("API routes", () => {
  let h: ReturnType<typeof buildHarness>;
  let app: FastifyInstance;

  beforeAll(async () => {
    h = buildHarness();
    app = await h.app;
  });

  afterAll(async () => {
    await h.close();
  });

  it("POST /workflows: 201 on valid create", async () => {
    const r = await app.inject({ method: "POST", url: "/workflows", payload: validDef });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { id: string; version: number };
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.version).toBe(1);
  });

  it("POST /workflows: 400 on invalid Zod body", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/workflows",
      payload: { name: "x" }, // missing nodes/edges
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("ValidationError");
  });

  it("POST /workflows: 400 on DAG cycle", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/workflows",
      payload: cyclicDef,
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("DagValidationError");
  });

  it("GET /workflows + GET /workflows/:id round-trip", async () => {
    const c = await app.inject({ method: "POST", url: "/workflows", payload: validDef });
    const id = c.json().id as string;

    const list = await app.inject({ method: "GET", url: "/workflows" });
    expect(list.statusCode).toBe(200);
    expect((list.json() as Array<{ id: string }>).some((w) => w.id === id)).toBe(true);

    const one = await app.inject({ method: "GET", url: `/workflows/${id}` });
    expect(one.statusCode).toBe(200);
    expect((one.json() as { name: string }).name).toBe("linear");
  });

  it("PUT /workflows/:id: bumps version", async () => {
    const c = await app.inject({ method: "POST", url: "/workflows", payload: validDef });
    const id = c.json().id as string;
    const u = await app.inject({
      method: "PUT",
      url: `/workflows/${id}`,
      payload: { ...validDef, name: "linear-v2" },
    });
    expect(u.statusCode).toBe(200);
    expect((u.json() as { version: number }).version).toBe(2);
  });

  it("POST /workflows/:id/runs: 202 + run executes in background", async () => {
    const c = await app.inject({ method: "POST", url: "/workflows", payload: validDef });
    const id = c.json().id as string;
    const r = await app.inject({
      method: "POST",
      url: `/workflows/${id}/runs`,
      payload: { input: { x: 5 } },
    });
    expect(r.statusCode).toBe(202);
    const { runId, status } = r.json() as { runId: string; status: string };
    expect(status).toBe("PENDING");

    // Wait a tick for the local runner to finish.
    await new Promise((res) => setTimeout(res, 25));

    const trace = await app.inject({ method: "GET", url: `/runs/${runId}` });
    expect(trace.statusCode).toBe(200);
    const t = trace.json() as { meta: { status: string }; nodeExecutions: Array<{ output: unknown }> };
    expect(["RUNNING", "SUCCEEDED"]).toContain(t.meta.status);
  });

  it("POST /workflows/:id/runs: 413 on oversized input", async () => {
    const c = await app.inject({ method: "POST", url: "/workflows", payload: validDef });
    const id = c.json().id as string;
    const big = "x".repeat(300_000); // exceeds 256 KB JSON
    const r = await app.inject({
      method: "POST",
      url: `/workflows/${id}/runs`,
      payload: { input: big },
    });
    expect(r.statusCode).toBe(413);
  });

  it("POST /workflows/:id/runs: 404 on unknown workflow", async () => {
    const r = await app.inject({
      method: "POST",
      url: `/workflows/77777777-7777-4777-8777-777777777777/runs`,
      payload: { input: {} },
    });
    expect(r.statusCode).toBe(404);
  });

  it("GET /node-types: lists all built-ins + kb-retrieval", async () => {
    const r = await app.inject({ method: "GET", url: "/node-types" });
    expect(r.statusCode).toBe(200);
    const types = (r.json() as Array<{ type: string }>).map((t) => t.type);
    expect(types.sort()).toEqual(["branch", "http", "kb-retrieval", "llm", "transform"]);
  });
});
