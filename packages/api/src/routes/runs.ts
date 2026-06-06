// Run trigger and trace routes.
//
//   POST /workflows/:id/runs   trigger a run; persists PENDING + dispatches async
//   GET  /runs/:id             full trace (META + node executions)
//   GET  /workflows/:id/runs   per-workflow run summaries

import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { RunRepo, WorkflowRepo } from "@workflow-engine/engine";

import { replyValidationError } from "../errors.js";
import type { RunRunner } from "../runRunner.js";

export interface RunRoutesDeps {
  workflowRepo: WorkflowRepo;
  runRepo: RunRepo;
  runner: RunRunner;
  /** Default 256 KB cap on `runInput`, per design. */
  maxInputBytes?: number;
}

const TriggerBody = z.object({ input: z.unknown() }).strict();

export async function registerRunRoutes(
  app: FastifyInstance,
  deps: RunRoutesDeps,
): Promise<void> {
  const maxBytes = deps.maxInputBytes ?? 256 * 1024;

  app.post<{ Params: { id: string } }>("/workflows/:id/runs", async (req, reply) => {
    const raw = req.body as unknown;
    // 413 check: serialise the input to measure bytes. We don't read
    // Content-Length because middleware may have decompressed.
    const size = Buffer.byteLength(JSON.stringify(raw ?? {}));
    if (size > maxBytes) {
      return reply.code(413).send({ error: "PayloadTooLarge", maxBytes });
    }

    const parsed = TriggerBody.safeParse(raw);
    if (!parsed.success) return replyValidationError(reply, parsed.error);

    // Confirm workflow exists; if not, 404 before creating a run.
    try {
      await deps.workflowRepo.get(req.params.id);
    } catch {
      return reply.code(404).send({ error: "WorkflowNotFound" });
    }

    const runId = randomUUID();
    await deps.runRepo.createRun({
      runId,
      workflowId: req.params.id,
      input: parsed.data.input,
    });

    await deps.runner.trigger({
      runId,
      workflowId: req.params.id,
      input: parsed.data.input,
    });

    return reply.code(202).send({ runId, status: "PENDING" });
  });

  app.get<{ Params: { id: string } }>("/runs/:id", async (req, reply) => {
    try {
      return await deps.runRepo.getRun(req.params.id);
    } catch {
      return reply.code(404).send({ error: "NotFound" });
    }
  });

  app.get<{ Params: { id: string } }>(
    "/workflows/:id/runs",
    async (req) => deps.runRepo.listRuns(req.params.id),
  );
}
