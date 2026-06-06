// Zod schemas and inferred TypeScript types for workflow definitions.
//
// These are the source of truth for:
//   - request validation in the API (POST /workflows, PUT /workflows/:id)
//   - the persisted shape across the workflows / nodes / edges Postgres tables
//   - the TypeScript types used by the engine, the executor, and the UI
//
// `.strict()` is applied to every object so that unknown keys are rejected
// (per the API contract: malformed input → HTTP 400 listing every field error).
//
// Size limits (`max 100` nodes, `max 500` edges, `name max 200`) protect
// against runaway payloads but are intentionally generous so they should not
// produce validation noise during normal authoring.

import { z } from "zod";

/**
 * A single node within a `WorkflowDef`.
 *
 * `id` is author-assigned within the scope of a workflow def (e.g. "classify",
 * "branch"). It is not constrained to UUIDs — the database row's primary key
 * is generated separately at persistence time.
 *
 * `config` is intentionally `z.unknown()` here. Per-type config validation is
 * delegated to the `NodeExecutor.configSchema` registered with the
 * `NodeRegistry` so that adding a new node type does not require touching this
 * schema.
 *
 * `position_x` / `position_y` exist for editor persistence — the React Flow
 * canvas reads these to lay nodes out exactly where the author placed them.
 */
export const NodeDefSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    name: z.string().optional(),
    config: z.unknown(),
    position_x: z.number().int(),
    position_y: z.number().int(),
  })
  .strict();

export type NodeDef = z.infer<typeof NodeDefSchema>;

/**
 * A directed edge between two nodes within a `WorkflowDef`.
 *
 * `id` is optional and UI-assigned. The database row gets a real UUID at
 * persistence time.
 *
 * `condition_expression` is only meaningful on edges leaving a Branch node;
 * it is nullable in the database (`condition_expression text NULL`) so we
 * accept both omitted and explicitly null on the wire.
 */
export const EdgeDefSchema = z
  .object({
    id: z.string().optional(),
    from: z.string().min(1),
    to: z.string().min(1),
    condition_expression: z.string().nullish(),
  })
  .strict();

export type EdgeDef = z.infer<typeof EdgeDefSchema>;

/**
 * The full workflow definition: metadata plus a node list and an edge list.
 *
 * `id` and `version` are present on read responses but not on `POST /workflows`
 * create requests, so both are optional at the schema level. The API layer
 * enforces stricter rules per route (e.g. rejecting client-supplied `id` on
 * create) on top of this schema.
 */
export const WorkflowDefSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    version: z.number().int().optional(),
    nodes: z.array(NodeDefSchema).min(1).max(100),
    edges: z.array(EdgeDefSchema).max(500),
  })
  .strict();

export type WorkflowDef = z.infer<typeof WorkflowDefSchema>;
