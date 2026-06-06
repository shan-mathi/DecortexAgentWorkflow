// Workflow CRUD routes.
//
//   POST /workflows         create
//   GET  /workflows         list (id/name/version)
//   GET  /workflows/:id     full definition
//   PUT  /workflows/:id     version-bumping update

import type { FastifyInstance } from "fastify";

import { validateDag, type NodeRegistry, type WorkflowRepo } from "@workflow-engine/engine";
import { WorkflowDefSchema } from "@workflow-engine/shared";

import { replyDagViolations, replyValidationError } from "../errors.js";

export interface WorkflowRoutesDeps {
  repo: WorkflowRepo;
  registry: NodeRegistry;
}

export async function registerWorkflowRoutes(
  app: FastifyInstance,
  deps: WorkflowRoutesDeps,
): Promise<void> {
  app.post("/workflows", async (req, reply) => {
    const parsed = WorkflowDefSchema.safeParse(req.body);
    if (!parsed.success) return replyValidationError(reply, parsed.error);

    const dag = validateDag(parsed.data, deps.registry);
    if (!dag.ok) return replyDagViolations(reply, dag.errors);

    const w = await deps.repo.create(parsed.data);
    return reply.code(201).send(w);
  });

  app.get("/workflows", async () => {
    return deps.repo.list();
  });

  app.get<{ Params: { id: string } }>("/workflows/:id", async (req, reply) => {
    try {
      return await deps.repo.get(req.params.id);
    } catch {
      return reply.code(404).send({ error: "NotFound" });
    }
  });

  app.put<{ Params: { id: string } }>("/workflows/:id", async (req, reply) => {
    const parsed = WorkflowDefSchema.safeParse(req.body);
    if (!parsed.success) return replyValidationError(reply, parsed.error);

    const dag = validateDag(parsed.data, deps.registry);
    if (!dag.ok) return replyDagViolations(reply, dag.errors);

    try {
      const w = await deps.repo.update(req.params.id, parsed.data);
      return reply.code(200).send(w);
    } catch {
      return reply.code(404).send({ error: "NotFound" });
    }
  });
}
