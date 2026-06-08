// RunRepository — all DB operations for execution runs and node traces.
//
// Responsibilities:
//   - Create a run (PENDING)
//   - Update run status (RUNNING → SUCCEEDED/FAILED)
//   - Append node execution (idempotent on run_id + node_id)
//   - Get full run trace (META + all node executions)
//   - List runs (optionally filtered by workflow)

import type pg from "pg";

import type { NodeExecution, RunStatus, RunSummary, RunTrace } from "../types/index.js";

export class RunRepository {
  constructor(private readonly pool: pg.Pool) {}

  async createRun(runId: string, workflowId: string, input: unknown): Promise<void> {
    await this.pool.query(
      `INSERT INTO runs (run_id, workflow_id, status, input) VALUES ($1, $2, $3, $4)`,
      [runId, workflowId, "PENDING", JSON.stringify(input)],
    );
  }

  async setStatus(runId: string, status: RunStatus, endedAt?: Date): Promise<void> {
    if (endedAt) {
      await this.pool.query(
        `UPDATE runs SET status = $1, ended_at = $2 WHERE run_id = $3`,
        [status, endedAt, runId],
      );
    } else {
      await this.pool.query(
        `UPDATE runs SET status = $1 WHERE run_id = $2`,
        [status, runId],
      );
    }
  }

  async appendNodeExecution(runId: string, ne: NodeExecution): Promise<void> {
    await this.pool.query(
      `INSERT INTO node_executions
        (run_id, node_id, registered_node_id, node_name, node_type, input, output, status, duration_ms, error, attempt_count, started_at, token_usage)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (run_id, node_id) DO NOTHING`,
      [
        runId,
        ne.nodeId,
        ne.registeredNodeId ?? null,
        ne.nodeName ?? null,
        ne.nodeType ?? null,
        ne.input ? JSON.stringify(ne.input) : null,
        ne.output ? JSON.stringify(ne.output) : null,
        ne.status,
        Math.trunc(ne.durationMs),
        ne.error ? JSON.stringify(ne.error) : null,
        ne.attemptCount,
        ne.startedAt,
        ne.tokenUsage ? JSON.stringify(ne.tokenUsage) : null,
      ],
    );
  }

  async getTrace(runId: string): Promise<RunTrace | null> {
    const { rows: metaRows } = await this.pool.query(
      `SELECT * FROM runs WHERE run_id = $1`,
      [runId],
    );
    if (metaRows.length === 0) return null;
    const meta = metaRows[0] as Record<string, unknown>;

    const { rows: neRows } = await this.pool.query(
      `SELECT * FROM node_executions WHERE run_id = $1 ORDER BY started_at`,
      [runId],
    );

    return {
      meta: {
        runId: meta.run_id as string,
        workflowId: meta.workflow_id as string,
        status: meta.status as RunStatus,
        startedAt: meta.started_at as Date,
        endedAt: (meta.ended_at as Date) ?? null,
        input: meta.input,
      },
      nodeExecutions: (neRows as Array<Record<string, unknown>>).map((r) => ({
        nodeId: r.node_id as string,
        registeredNodeId: r.registered_node_id as string | undefined,
        nodeName: r.node_name as string | undefined,
        nodeType: r.node_type as string | undefined,
        input: r.input,
        output: r.output,
        status: r.status as "SUCCEEDED" | "FAILED" | "SKIPPED",
        durationMs: r.duration_ms as number,
        error: r.error as { message: string; stack?: string } | undefined,
        attemptCount: r.attempt_count as number,
        startedAt: r.started_at as Date,
        tokenUsage: r.token_usage as { promptTokens: number; completionTokens: number } | undefined,
      })),
    };
  }

  async listRuns(workflowId?: string): Promise<RunSummary[]> {
    let query = `SELECT * FROM runs`;
    const params: string[] = [];
    if (workflowId) {
      query += ` WHERE workflow_id = $1`;
      params.push(workflowId);
    }
    query += ` ORDER BY started_at DESC LIMIT 100`;
    const { rows } = await this.pool.query(query, params);
    return (rows as Array<Record<string, unknown>>).map((r) => ({
      runId: r.run_id as string,
      workflowId: r.workflow_id as string,
      status: r.status as RunStatus,
      startedAt: r.started_at as Date,
      endedAt: (r.ended_at as Date) ?? null,
      input: r.input,
    }));
  }
}
