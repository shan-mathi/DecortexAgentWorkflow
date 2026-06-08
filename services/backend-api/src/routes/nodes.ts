// Registered Node routes — proxy to Workflow Engine.

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { EngineClient } from "../engine-client.js";

const RegisterNodeBody = z.object({
  name: z.string().min(1).max(200),
  nodeTypeId: z.string().uuid(),
  category: z.enum(["llm", "http", "branch", "transform"]),
  description: z.string().max(2000).optional(),
  config: z.unknown(),
  version: z.string().max(50).optional(),
});

export async function registerNodeRoutes(app: FastifyInstance, engine: EngineClient): Promise<void> {
  app.get("/api/nodes", async (_req, reply) => {
    const r = await engine.get("/nodes");
    return reply.code(r.status).send(r.data);
  });

  app.get<{ Params: { id: string } }>("/api/nodes/:id", async (req, reply) => {
    const r = await engine.get(`/nodes/${req.params.id}`);
    return reply.code(r.status).send(r.data);
  });

  app.post("/api/nodes", async (req, reply) => {
    const parsed = RegisterNodeBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "ValidationError", issues: parsed.error.issues });
    }
    const r = await engine.post("/nodes", parsed.data);
    return reply.code(r.status).send(r.data);
  });

  app.delete<{ Params: { id: string } }>("/api/nodes/:id", async (req, reply) => {
    const r = await engine.forward("DELETE", `/nodes/${req.params.id}`);
    return reply.code(r.status).send(r.data);
  });
}
