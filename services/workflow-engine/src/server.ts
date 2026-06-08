// Workflow Engine Fastify server.
// Deployed on Fargate; exposes REST endpoints consumed by Backend API (Lambda).

import cors from "@fastify/cors";
import Fastify from "fastify";

import {
  getPool,
  migrate,
  NodeRegistrationRepository,
  NodeTypeRepository,
  RunRepository,
  WorkflowRepository,
} from "./db/index.js";
import { executeWorkflow } from "./executor/run-workflow.js";
import { logger } from "./lib/logger.js";
import { createHandlerRegistry } from "./nodes/index.js";
import { NodeRegistrationService } from "./workflow/node-registration-service.js";
import { NodeTypeService } from "./workflow/node-type-service.js";
import { WorkflowService } from "./workflow/workflow-service.js";

async function migrateWithRetry(maxRetries = 10, delayMs = 3000): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await migrate();
      return;
    } catch (err) {
      const msg = (err as Error).message;
      logger.warn({ attempt, maxRetries, error: msg }, "Migration failed, retrying...");
      if (attempt === maxRetries) {
        logger.error({ error: msg }, "Migration failed after all retries");
        throw err;
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function main() {
  const pool = getPool();
  await migrateWithRetry();

  // Repositories (all DB access goes through here)
  const nodeTypeRepo = new NodeTypeRepository(pool);
  const nodeRegRepo = new NodeRegistrationRepository(pool);
  const workflowRepo = new WorkflowRepository(pool);
  const runRepo = new RunRepository(pool);

  // Services (business logic, delegates to repos)
  const nodeTypeService = new NodeTypeService(nodeTypeRepo);
  const nodeRegService = new NodeRegistrationService(nodeRegRepo);
  const workflowService = new WorkflowService(workflowRepo);

  // Node handlers (in-process execution)
  const handlers = createHandlerRegistry();

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  // Request-level logging with requestId propagation
  app.addHook("onRequest", async (req) => {
    const requestId = (req.headers["x-request-id"] as string) ?? logger.generateRequestId();
    (req as unknown as { requestId: string }).requestId = requestId;
    logger.info({ requestId, method: req.method, url: req.url }, "Request received");
  });
  app.addHook("onResponse", async (req, reply) => {
    const requestId = (req as unknown as { requestId: string }).requestId;
    logger.info({ requestId, method: req.method, url: req.url, statusCode: reply.statusCode, durationMs: Math.round(reply.elapsedTime) }, "Request completed");
  });
  app.addHook("onError", async (req, _reply, error) => {
    const requestId = (req as unknown as { requestId: string }).requestId;
    logger.error({ requestId, method: req.method, url: req.url, error: error.message, stack: error.stack }, "Request error");
  });

  // Health
  app.get("/health", async () => ({ status: "ok" }));


  // --- Node Types ---
  app.get("/node-types", async () => nodeTypeService.list());

  app.get<{ Params: { id: string } }>("/node-types/:id", async (req, reply) => {
    const t = await nodeTypeService.getById(req.params.id);
    if (!t) return reply.code(404).send({ error: "NotFound" });
    return t;
  });

  app.post("/node-types", async (req, reply) => {
    const body = req.body as { name: string; category: string; description?: string; configSchema?: unknown };
    const t = await nodeTypeService.create(body);
    return reply.code(201).send(t);
  });

  // --- Registered Nodes ---
  app.get("/nodes", async () => nodeRegService.list());

  app.get<{ Params: { id: string } }>("/nodes/:id", async (req, reply) => {
    const n = await nodeRegService.getById(req.params.id);
    if (!n) return reply.code(404).send({ error: "NotFound" });
    return n;
  });

  app.post("/nodes", async (req, reply) => {
    const body = req.body as {
      name: string;
      nodeTypeId: string;
      category: string;
      description?: string;
      config: unknown;
      version?: string;
    };
    const n = await nodeRegService.register(body);
    return reply.code(201).send(n);
  });

  app.delete<{ Params: { id: string } }>("/nodes/:id", async (req, reply) => {
    const deleted = await nodeRegService.delete(req.params.id);
    if (!deleted) return reply.code(404).send({ error: "NotFound" });
    return reply.code(204).send();
  });

  // --- Workflows ---
  app.get("/workflows", async () => workflowService.list());

  app.get<{ Params: { id: string } }>("/workflows/:id", async (req, reply) => {
    const w = await workflowService.getById(req.params.id);
    if (!w) return reply.code(404).send({ error: "NotFound" });
    return w;
  });

  app.post("/workflows", async (req, reply) => {
    const body = req.body as {
      name: string;
      description?: string;
      nodes: Array<{ nodeId: string; registeredNodeId: string; name?: string; configOverride?: unknown; positionX?: number; positionY?: number }>;
      edges: Array<{ from: string; to: string; conditionExpression?: string | null }>;
    };
    const w = await workflowService.create(body);
    return reply.code(201).send(w);
  });

  app.delete<{ Params: { id: string } }>("/workflows/:id", async (req, reply) => {
    const deleted = await workflowService.delete(req.params.id);
    if (!deleted) return reply.code(404).send({ error: "NotFound" });
    return reply.code(204).send();
  });

  app.put<{ Params: { id: string } }>("/workflows/:id", async (req, reply) => {
    const body = req.body as {
      name: string;
      description?: string;
      nodes: Array<{ nodeId: string; registeredNodeId: string; name?: string; configOverride?: unknown; positionX?: number; positionY?: number }>;
      edges: Array<{ from: string; to: string; conditionExpression?: string | null }>;
    };
    try {
      const w = await workflowService.update(req.params.id, body);
      return reply.code(200).send(w);
    } catch {
      return reply.code(404).send({ error: "NotFound" });
    }
  });

  // --- Executions ---
  app.post("/executions", async (req, reply) => {
    const body = req.body as { workflowId: string; input: unknown };
    const workflow = await workflowService.getById(body.workflowId);
    if (!workflow) return reply.code(404).send({ error: "WorkflowNotFound" });

    const result = await executeWorkflow(workflow, body.input, {
      runRepo,
      nodeRepo: nodeRegRepo,
      handlers,
    });
    return reply.code(202).send(result);
  });

  app.get<{ Params: { id: string } }>("/executions/:id", async (req, reply) => {
    const trace = await runRepo.getTrace(req.params.id);
    if (!trace) return reply.code(404).send({ error: "NotFound" });
    return trace;
  });

  app.get<{ Querystring: { workflowId?: string } }>("/executions", async (req) => {
    return runRepo.listRuns(req.query.workflowId);
  });

  // Start
  const port = Number(process.env.PORT ?? 4000);
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`[workflow-engine] listening on http://localhost:${port}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
