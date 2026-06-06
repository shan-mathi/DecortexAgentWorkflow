// Fastify app factory.
//
// `buildApp(deps)` returns a configured Fastify instance ready to
// listen (locally) or be wrapped by `@fastify/aws-lambda` (in AWS).
// All cross-cutting concerns — JSON parsing, CORS, request logging,
// error mapping — live here. Route files only describe the route.
//
// We attach a non-default 1MB body limit so large workflow JSONs
// (with many nodes) are not rejected pre-validation.

import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";

import type { NodeRegistry, RunRepo, WorkflowRepo } from "@workflow-engine/engine";

import { registerNodeTypeRoutes } from "./routes/nodeTypes.js";
import { registerRunRoutes } from "./routes/runs.js";
import { registerWorkflowRoutes } from "./routes/workflows.js";
import type { RunRunner } from "./runRunner.js";

export interface AppDeps {
  workflowRepo: WorkflowRepo;
  runRepo: RunRepo;
  registry: NodeRegistry;
  runner: RunRunner;
  /** Default 1 MB body limit. */
  bodyLimit?: number;
  /** Default 256 KB cap on `runInput`. */
  maxRunInputBytes?: number;
  /** Pino-compatible logger config. `false` disables logging in tests. */
  logger?: boolean;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger ?? false,
    bodyLimit: deps.bodyLimit ?? 1024 * 1024,
  });

  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ status: "ok" }));

  await registerWorkflowRoutes(app, {
    repo: deps.workflowRepo,
    registry: deps.registry,
  });
  await registerRunRoutes(app, {
    workflowRepo: deps.workflowRepo,
    runRepo: deps.runRepo,
    runner: deps.runner,
    ...(deps.maxRunInputBytes !== undefined ? { maxInputBytes: deps.maxRunInputBytes } : {}),
  });
  await registerNodeTypeRoutes(app, { registry: deps.registry });

  return app;
}
