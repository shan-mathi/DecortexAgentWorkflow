// Schemas + types describing a single node execution.
//
// `NodeContext` is what the executor hands a `NodeExecutor.execute()` call:
// the run identity, the run-level input, and the immediate parents' results.
//
// `NodeResult` is what the node returns — JSON-serialisable `output`, a
// status, an optional structured error, the wall-clock `durationMs` (set by
// `runNodeWithRetry`, not by node implementations), and optional
// `tokenUsage` for nodes that touch the LLM provider.
//
// These shapes are persisted as part of the run trace, so they double as
// API response shapes — hence Zod schemas alongside the TypeScript types.

import { z } from "zod";

/**
 * Token accounting for any LLMProvider call (`complete` or `embed`).
 *
 * Only `llm` and `kb-retrieval` nodes set this in their result.
 */
export const TokenUsageSchema = z
  .object({
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
  })
  .strict();

export type TokenUsage = z.infer<typeof TokenUsageSchema>;

/**
 * The three terminal states a single node execution can resolve to.
 *
 * `SKIPPED` is recorded for every node downstream of a non-taken Branch —
 * it is a real persisted record so the trace remains a complete causal log.
 */
export const NodeStatusSchema = z.enum(["SUCCEEDED", "FAILED", "SKIPPED"]);

export type NodeStatus = z.infer<typeof NodeStatusSchema>;

/**
 * Structured error attached to a `FAILED` node result.
 *
 * `stack` is optional because the API surface deliberately strips it for
 * external clients; the engine still records it on append.
 */
export const NodeErrorSchema = z
  .object({
    message: z.string(),
    stack: z.string().optional(),
  })
  .strict();

export type NodeError = z.infer<typeof NodeErrorSchema>;

/**
 * What a node `execute()` returns.
 *
 * `durationMs` is set by `runNodeWithRetry` from the start of `execute` to
 * the resolution of its returned promise — node implementations may set
 * `0` and the wrapper overwrites.
 */
export const NodeResultSchema = z
  .object({
    output: z.unknown(),
    status: NodeStatusSchema,
    error: NodeErrorSchema.optional(),
    durationMs: z.number().nonnegative(),
    tokenUsage: TokenUsageSchema.optional(),
  })
  .strict();

export type NodeResult = z.infer<typeof NodeResultSchema>;

/**
 * What the executor hands to `NodeExecutor.execute(config, ctx)`.
 *
 * Not used as a request/response shape on the wire, so a TypeScript
 * interface is sufficient and a Zod schema is omitted.
 */
export interface NodeContext {
  runId: string;
  nodeId: string;
  runInput: unknown;
  upstream: Record<string, NodeResult>;
  metadata: { workflowId: string; attempt: number };
}
