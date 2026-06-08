// Node Type routes — proxy to Workflow Engine.

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { EngineClient } from "../engine-client.js";

const CreateNodeTypeBody = z.object({
  name: z.string().min(1).max(100),
  category: z.enum(["llm", "http", "branch", "transform"]),
  description: z.string().max(2000).optional(),
  configSchema: z.unknown().optional(),
});

export async function registerNodeTypeRoutes(app: FastifyInstance, engine: EngineClient): Promise<void> {
  app.get("/api/node-types", async (_req, reply) => {
    const r = await engine.get("/node-types");
    return reply.code(r.status).send(r.data);
  });

  app.get<{ Params: { id: string } }>("/api/node-types/:id", async (req, reply) => {
    const r = await engine.get(`/node-types/${req.params.id}`);
    return reply.code(r.status).send(r.data);
  });

  app.post("/api/node-types", async (req, reply) => {
    const parsed = CreateNodeTypeBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "ValidationError", issues: parsed.error.issues });
    }
    const r = await engine.post("/node-types", parsed.data);
    return reply.code(r.status).send(r.data);
  });
}
