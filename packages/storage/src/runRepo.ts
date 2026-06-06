// Postgres-backed `RunRepo`.
//
// Idempotency on (run_id, node_id) is enforced both at the schema
// level (PRIMARY KEY) and on insert via `ON CONFLICT DO NOTHING` so a
// retried executor invocation never produces a duplicate row, never
// throws, and never overwrites the first persisted record.
//
// `getRun` runs two queries (META + node executions) in parallel.

import { asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { RunRepo } from "@workflow-engine/engine";
import type {
  NodeError,
  NodeExecution,
  NodeStatus,
  RunStatus,
  RunSummary,
  RunTrace,
  TokenUsage,
} from "@workflow-engine/shared";

import { nodeExecutions, runs } from "./schema.js";

export class RunRepoPostgres implements RunRepo {
  constructor(private readonly db: NodePgDatabase) {}

  async createRun(run: { runId: string; workflowId: string; input: unknown }): Promise<void> {
    await this.db.insert(runs).values({
      runId: run.runId,
      workflowId: run.workflowId,
      status: "PENDING",
      input: run.input as object,
    });
  }

  async setRunStatus(runId: string, status: RunStatus, endedAt?: Date): Promise<void> {
    const update: { status: RunStatus; endedAt?: Date } = { status };
    if (endedAt) update.endedAt = endedAt;
    await this.db.update(runs).set(update).where(eq(runs.runId, runId));
  }

  async appendNodeExecution(runId: string, ne: NodeExecution): Promise<void> {
    await this.db
      .insert(nodeExecutions)
      .values({
        runId,
        nodeId: ne.nodeId,
        input: ne.input as object,
        output: ne.output as object,
        status: ne.status,
        durationMs: Math.trunc(ne.durationMs),
        error: (ne.error ?? null) as object | null,
        attemptCount: ne.attemptCount,
        startedAt: ne.startedAt,
        tokenUsage: (ne.tokenUsage ?? null) as object | null,
      })
      .onConflictDoNothing({ target: [nodeExecutions.runId, nodeExecutions.nodeId] });
  }

  async getRun(runId: string): Promise<RunTrace> {
    const [metaRows, neRows] = await Promise.all([
      this.db.select().from(runs).where(eq(runs.runId, runId)),
      this.db
        .select()
        .from(nodeExecutions)
        .where(eq(nodeExecutions.runId, runId)),
    ]);

    const meta = metaRows[0];
    if (!meta) throw new Error(`Run not found: ${runId}`);

    const summary: RunSummary = {
      runId: meta.runId,
      workflowId: meta.workflowId,
      status: meta.status as RunStatus,
      startedAt: meta.startedAt,
      endedAt: meta.endedAt,
      input: meta.input,
    };

    const executions: NodeExecution[] = neRows.map((r) => ({
      nodeId: r.nodeId,
      input: r.input,
      output: r.output,
      status: r.status as NodeStatus,
      durationMs: r.durationMs,
      error: (r.error ?? undefined) as NodeError | undefined,
      attemptCount: r.attemptCount,
      startedAt: r.startedAt,
      tokenUsage: (r.tokenUsage ?? undefined) as TokenUsage | undefined,
    }));

    return { meta: summary, nodeExecutions: executions };
  }

  async listRuns(workflowId: string): Promise<RunSummary[]> {
    const rows = await this.db
      .select()
      .from(runs)
      .where(eq(runs.workflowId, workflowId))
      .orderBy(asc(runs.startedAt));

    return rows.map((r) => ({
      runId: r.runId,
      workflowId: r.workflowId,
      status: r.status as RunStatus,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      input: r.input,
    }));
  }
}

