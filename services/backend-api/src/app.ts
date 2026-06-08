// Backend API Fastify app builder.
//
// In production: wrapped by @fastify/aws-lambda behind API Gateway.
// In local dev: runs as a standalone Fastify server on port 3000.
//
// This service is intentionally thin:
//   1. Validate the incoming request (Zod schemas)
//   2. Forward to the Workflow Engine (Fargate)
//   3. Return the engine's response
//
// No business logic, no DB connections, no node execution.

import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";

import { EngineClient } from "./engine-client.js";
import { logger } from "./lib/logger.js";
import { registerExecutionRoutes } from "./routes/executions.js";
import { registerNodeRoutes } from "./routes/nodes.js";
import { registerNodeTypeRoutes } from "./routes/node-types.js";
import { registerWorkflowRoutes } from "./routes/workflows.js";

export interface AppConfig {
  engineUrl?: string;
  logger?: boolean;
}

export async function buildApp(config?: AppConfig): Promise<FastifyInstance> {
  const engine = new EngineClient({ baseUrl: config?.engineUrl });

  const app = Fastify({
    logger: config?.logger ?? false,
    bodyLimit: 1024 * 1024,
  });

  await app.register(cors, { origin: true });

  // Request logging + request ID propagation to downstream engine
  app.addHook("onRequest", async (req) => {
    const requestId = (req.headers["x-request-id"] as string) ?? logger.generateRequestId();
    (req as unknown as { requestId: string }).requestId = requestId;
    logger.info({ requestId, method: req.method, url: req.url }, "Incoming request");
  });
  app.addHook("onResponse", async (req, reply) => {
    const requestId = (req as unknown as { requestId: string }).requestId;
    logger.info({ requestId, statusCode: reply.statusCode, durationMs: Math.round(reply.elapsedTime) }, "Response sent");
  });
  app.addHook("onError", async (req, _reply, error) => {
    const requestId = (req as unknown as { requestId: string }).requestId;
    logger.error({ requestId, error: error.message, stack: error.stack }, "Unhandled error");
  });

  // Health (checks both self and engine)
  app.get("/api/health", async (_req, reply) => {
    try {
      const r = await engine.get("/health");
      if (r.status === 200) {
        return { status: "ok", engine: "connected" };
      }
      return reply.code(503).send({ status: "degraded", engine: "unhealthy" });
    } catch {
      return reply.code(503).send({ status: "degraded", engine: "unreachable" });
    }
  });

  await registerNodeTypeRoutes(app, engine);
  await registerNodeRoutes(app, engine);
  await registerWorkflowRoutes(app, engine);
  await registerExecutionRoutes(app, engine);

  return app;
}
