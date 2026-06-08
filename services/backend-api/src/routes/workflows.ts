// Workflow routes — proxy to Workflow Engine.

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { EngineClient } from "../engine-client.js";

const WorkflowNodeSchema = z.object({
  nodeId: z.string().min(1),
  registeredNodeId: z.string().uuid(),
  name: z.string().optional(),
  configOverride: z.unknown().optional(),
  positionX: z.number().int().optional(),
  positionY: z.number().int().optional(),
});

const WorkflowEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  conditionExpression: z.string().nullish(),
});

const CreateWorkflowBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  nodes: z.array(WorkflowNodeSchema).min(1).max(100),
  edges: z.array(WorkflowEdgeSchema).max(500),
});

export async function registerWorkflowRoutes(app: FastifyInstance, engine: EngineClient): Promise<void> {
  app.get("/api/workflows", async (_req, reply) => {
    const r = await engine.get("/workflows");
    return reply.code(r.status).send(r.data);
  });

  app.get<{ Params: { id: string } }>("/api/workflows/:id", async (req, reply) => {
    const r = await engine.get(`/workflows/${req.params.id}`);
    return reply.code(r.status).send(r.data);
  });

  app.post("/api/workflows", async (req, reply) => {
    const parsed = CreateWorkflowBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "ValidationError", issues: parsed.error.issues });
    }
    const r = await engine.post("/workflows", parsed.data);
    return reply.code(r.status).send(r.data);
  });

  app.put<{ Params: { id: string } }>("/api/workflows/:id", async (req, reply) => {
    const parsed = CreateWorkflowBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "ValidationError", issues: parsed.error.issues });
    }
    const r = await engine.put(`/workflows/${req.params.id}`, parsed.data);
    return reply.code(r.status).send(r.data);
  });

  app.delete<{ Params: { id: string } }>("/api/workflows/:id", async (req, reply) => {
    const r = await engine.forward("DELETE", `/workflows/${req.params.id}`);
    return reply.code(r.status).send(r.data);
  });
}
