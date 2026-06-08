// Execution routes — proxy to Workflow Engine.

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { EngineClient } from "../engine-client.js";

const TriggerExecutionBody = z.object({
  workflowId: z.string().uuid(),
  input: z.unknown(),
});

const MAX_INPUT_BYTES = 256 * 1024;

export async function registerExecutionRoutes(app: FastifyInstance, engine: EngineClient): Promise<void> {
  app.post("/api/executions", async (req, reply) => {
    // Size check before forwarding
    const rawSize = Buffer.byteLength(JSON.stringify(req.body ?? {}));
    if (rawSize > MAX_INPUT_BYTES) {
      return reply.code(413).send({ error: "PayloadTooLarge", maxBytes: MAX_INPUT_BYTES });
    }

    const parsed = TriggerExecutionBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "ValidationError", issues: parsed.error.issues });
    }

    const r = await engine.post("/executions", parsed.data);
    return reply.code(r.status).send(r.data);
  });

  app.get<{ Params: { id: string } }>("/api/executions/:id", async (req, reply) => {
    const r = await engine.get(`/executions/${req.params.id}`);
    return reply.code(r.status).send(r.data);
  });

  app.get<{ Querystring: { workflowId?: string } }>("/api/executions", async (req, reply) => {
    const path = req.query.workflowId
      ? `/executions?workflowId=${req.query.workflowId}`
      : "/executions";
    const r = await engine.get(path);
    return reply.code(r.status).send(r.data);
  });
}
