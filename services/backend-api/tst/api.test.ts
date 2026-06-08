import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";

// Mock engine that returns canned responses for each route
const MOCK_PORT = 14000;
let mockEngine: FastifyInstance;
let app: FastifyInstance;

beforeAll(async () => {
  // Start a mock "Workflow Engine" server
  const { default: Fastify } = await import("fastify");
  mockEngine = Fastify();
  mockEngine.get("/health", async () => ({ status: "ok" }));
  mockEngine.get("/node-types", async () => [{ id: "1", name: "LLM", category: "llm" }]);
  mockEngine.get("/nodes", async () => [{ id: "n1", name: "classify", category: "llm" }]);
  mockEngine.post("/nodes", async (req, reply) => reply.code(201).send({ id: "new-id", ...(req.body as object) }));
  mockEngine.delete("/nodes/:id", async (_req, reply) => reply.code(204).send());
  mockEngine.get("/workflows", async () => [{ id: "wf1", name: "test", version: 1 }]);
  mockEngine.post("/workflows", async (req, reply) => reply.code(201).send({ id: "wf-new", name: "test", version: 1 }));
  mockEngine.delete("/workflows/:id", async (_req, reply) => reply.code(204).send());
  mockEngine.post("/executions", async (_req, reply) => reply.code(202).send({ runId: "run-1", status: "PENDING" }));
  mockEngine.get("/executions/:id", async () => ({ meta: { runId: "run-1", status: "SUCCEEDED" }, nodeExecutions: [] }));
  mockEngine.get("/executions", async () => []);
  await mockEngine.listen({ port: MOCK_PORT, host: "127.0.0.1" });

  // Build the Backend API pointing at the mock engine
  app = await buildApp({ engineUrl: `http://127.0.0.1:${MOCK_PORT}`, logger: false });
});

afterAll(async () => {
  await app?.close();
  await mockEngine?.close();
});

describe("Backend API routes", () => {
  it("GET /api/health returns ok with engine connected", async () => {
    const r = await app.inject({ method: "GET", url: "/api/health" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ status: "ok", engine: "connected" });
  });

  it("GET /api/node-types proxies to engine", async () => {
    const r = await app.inject({ method: "GET", url: "/api/node-types" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual([{ id: "1", name: "LLM", category: "llm" }]);
  });

  it("POST /api/nodes validates body and proxies", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/nodes",
      payload: { name: "test", nodeTypeId: "11111111-1111-4111-8111-111111111111", category: "llm", config: {} },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().id).toBe("new-id");
  });

  it("POST /api/nodes rejects invalid body with 400", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/nodes",
      payload: { name: "", category: "invalid" },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("ValidationError");
  });

  it("DELETE /api/nodes/:id proxies delete", async () => {
    const r = await app.inject({ method: "DELETE", url: "/api/nodes/some-id" });
    expect(r.statusCode).toBe(204);
  });

  it("GET /api/workflows proxies to engine", async () => {
    const r = await app.inject({ method: "GET", url: "/api/workflows" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toHaveLength(1);
  });

  it("POST /api/workflows validates and proxies", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/workflows",
      payload: {
        name: "wf",
        nodes: [{ nodeId: "a", registeredNodeId: "11111111-1111-4111-8111-111111111111" }],
        edges: [],
      },
    });
    expect(r.statusCode).toBe(201);
  });

  it("POST /api/workflows rejects missing name with 400", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/workflows",
      payload: { nodes: [], edges: [] },
    });
    expect(r.statusCode).toBe(400);
  });

  it("POST /api/executions validates and proxies", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/executions",
      payload: { workflowId: "11111111-1111-4111-8111-111111111111", input: { text: "hello" } },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().runId).toBe("run-1");
  });

  it("POST /api/executions rejects oversized payload with 413", async () => {
    const big = "x".repeat(300_000);
    const r = await app.inject({
      method: "POST",
      url: "/api/executions",
      payload: { workflowId: "11111111-1111-4111-8111-111111111111", input: big },
    });
    expect(r.statusCode).toBe(413);
  });

  it("POST /api/executions rejects missing workflowId with 400", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/executions",
      payload: { input: {} },
    });
    expect(r.statusCode).toBe(400);
  });

  it("GET /api/executions/:id proxies trace", async () => {
    const r = await app.inject({ method: "GET", url: "/api/executions/run-1" });
    expect(r.statusCode).toBe(200);
    expect(r.json().meta.runId).toBe("run-1");
  });
});
