// Schemas + types describing a workflow *run*.
//
// A "run" is one invocation of a workflow against a specific input. It has
// a META row (run-level status, timestamps, input) plus N node-execution
// rows (per-node trace). The `RunTrace` returned by `GET /runs/:id` joins
// META + all node executions so the UI can render the run page in one
// round-trip.

import { z } from "zod";

import { NodeErrorSchema, NodeStatusSchema, TokenUsageSchema } from "./node.js";

/**
 * The four states a run transitions through.
 *
 * The lifecycle is exactly: `PENDING -> RUNNING -> (SUCCEEDED | FAILED)`.
 * The API persists `PENDING` synchronously when `POST /workflows/:id/runs`
 * accepts the request; the executor flips to `RUNNING` on first execution
 * and to a terminal status when the last level finishes (or terminal-on-
 * failure short-circuits).
 */
export const RunStatusSchema = z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED"]);

export type RunStatus = z.infer<typeof RunStatusSchema>;

/**
 * One persisted node-execution record for a given `(runId, nodeId)`.
 *
 * `attemptCount` is the number of times `runNodeWithRetry` invoked
 * `executor.execute` before settling — `1` on first-attempt success.
 * `startedAt` is set at the start of the *first* attempt; `durationMs`
 * spans the final attempt only (matches the `NodeResult.durationMs`
 * contract used by the wrapper).
 */
export const NodeExecutionSchema = z
  .object({
    nodeId: z.string().min(1),
    input: z.unknown(),
    output: z.unknown(),
    status: NodeStatusSchema,
    durationMs: z.number().nonnegative(),
    error: NodeErrorSchema.optional(),
    attemptCount: z.number().int().positive(),
    startedAt: z.coerce.date(),
    tokenUsage: TokenUsageSchema.optional(),
  })
  .strict();

export type NodeExecution = z.infer<typeof NodeExecutionSchema>;

/**
 * Run META row. Persisted synchronously on `POST /workflows/:id/runs`
 * (status `PENDING`) and updated by the executor on `RUNNING` and
 * terminal transitions. `endedAt` is `null` until terminal.
 */
export const RunSummarySchema = z
  .object({
    runId: z.string().uuid(),
    workflowId: z.string().uuid(),
    status: RunStatusSchema,
    startedAt: z.coerce.date(),
    endedAt: z.coerce.date().nullable(),
    input: z.unknown(),
  })
  .strict();

export type RunSummary = z.infer<typeof RunSummarySchema>;

/**
 * Full run trace returned by `GET /runs/:id`: META + all node executions.
 *
 * The repository must populate this from a single round-trip (one DDB
 * `Query PK=RUN#{runId}` in AWS, one SQL query locally).
 */
export const RunTraceSchema = z
  .object({
    meta: RunSummarySchema,
    nodeExecutions: z.array(NodeExecutionSchema),
  })
  .strict();

export type RunTrace = z.infer<typeof RunTraceSchema>;
