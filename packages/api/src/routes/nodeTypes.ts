// `GET /node-types` — drives the UI palette + auto-generated config
// forms via `@rjsf/core`. The same registry the executor consumes
// produces this list, so a newly registered node appears here without
// any UI code change.

import type { FastifyInstance } from "fastify";

import type { NodeRegistry } from "@workflow-engine/engine";
import type { ZodType } from "zod";

import { schemaToJsonSchema } from "../jsonSchema.js";

export interface NodeTypeRoutesDeps {
  registry: NodeRegistry;
}

export async function registerNodeTypeRoutes(
  app: FastifyInstance,
  deps: NodeTypeRoutesDeps,
): Promise<void> {
  app.get("/node-types", async () => {
    return deps.registry.list().map((e) => ({
      type: e.type,
      displayName: e.displayName ?? e.type,
      description: e.description ?? "",
      category: e.category ?? "data",
      configSchema: schemaToJsonSchema(e.configSchema as ZodType<unknown>),
    }));
  });
}
