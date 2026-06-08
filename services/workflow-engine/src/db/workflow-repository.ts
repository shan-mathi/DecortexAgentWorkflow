// WorkflowRepository — all DB operations for workflows, workflow nodes, and edges.

import { randomUUID } from "node:crypto";

import type pg from "pg";

export interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface WorkflowNodeRow {
  nodeId: string;
  registeredNodeId: string;
  name: string | null;
  configOverride: unknown;
  positionX: number;
  positionY: number;
}

export interface WorkflowEdgeRow {
  from: string;
  to: string;
  conditionExpression: string | null;
}

export interface WorkflowFull {
  id: string;
  name: string;
  description: string | null;
  version: number;
  nodes: WorkflowNodeRow[];
  edges: WorkflowEdgeRow[];
}

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  nodes: Array<{
    nodeId: string;
    registeredNodeId: string;
    name?: string;
    configOverride?: unknown;
    positionX?: number;
    positionY?: number;
  }>;
  edges: Array<{
    from: string;
    to: string;
    conditionExpression?: string | null;
  }>;
}

export class WorkflowRepository {
  constructor(private readonly pool: pg.Pool) {}

  async create(input: CreateWorkflowInput): Promise<WorkflowRow> {
    const id = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO workflows (id, name, description) VALUES ($1, $2, $3)`,
        [id, input.name, input.description ?? null],
      );

      for (const n of input.nodes) {
        await client.query(
          `INSERT INTO workflow_nodes (workflow_id, node_id, registered_node_id, name, config_override, position_x, position_y)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, n.nodeId, n.registeredNodeId, n.name ?? null, JSON.stringify(n.configOverride ?? {}), n.positionX ?? 0, n.positionY ?? 0],
        );
      }

      for (const e of input.edges) {
        await client.query(
          `INSERT INTO workflow_edges (workflow_id, from_node, to_node, condition_expression)
           VALUES ($1, $2, $3, $4)`,
          [id, e.from, e.to, e.conditionExpression ?? null],
        );
      }

      await client.query("COMMIT");
      return { id, name: input.name, description: input.description ?? null, version: 1, created_at: new Date(), updated_at: new Date() };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async list(): Promise<WorkflowRow[]> {
    const { rows } = await this.pool.query<WorkflowRow>(
      `SELECT id, name, description, version, created_at, updated_at FROM workflows ORDER BY updated_at DESC`,
    );
    return rows;
  }

  async getById(id: string): Promise<WorkflowFull | null> {
    const { rows: wfRows } = await this.pool.query<WorkflowRow>(
      `SELECT * FROM workflows WHERE id = $1`,
      [id],
    );
    if (wfRows.length === 0) return null;
    const wf = wfRows[0]!;

    const [nodeResult, edgeResult] = await Promise.all([
      this.pool.query(
        `SELECT node_id, registered_node_id, name, config_override, position_x, position_y
         FROM workflow_nodes WHERE workflow_id = $1`,
        [id],
      ),
      this.pool.query(
        `SELECT from_node, to_node, condition_expression
         FROM workflow_edges WHERE workflow_id = $1`,
        [id],
      ),
    ]);

    return {
      id: wf.id,
      name: wf.name,
      description: wf.description,
      version: wf.version,
      nodes: nodeResult.rows.map((r: Record<string, unknown>) => ({
        nodeId: r.node_id as string,
        registeredNodeId: r.registered_node_id as string,
        name: r.name as string | null,
        configOverride: r.config_override,
        positionX: r.position_x as number,
        positionY: r.position_y as number,
      })),
      edges: edgeResult.rows.map((r: Record<string, unknown>) => ({
        from: r.from_node as string,
        to: r.to_node as string,
        conditionExpression: r.condition_expression as string | null,
      })),
    };
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM workflows WHERE id = $1`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  }

  async update(id: string, input: CreateWorkflowInput): Promise<WorkflowRow> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: existing } = await client.query<{ version: number }>(
        `SELECT version FROM workflows WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (existing.length === 0) throw new Error(`Workflow not found: ${id}`);
      const nextVersion = existing[0]!.version + 1;

      await client.query(
        `UPDATE workflows SET name = $1, description = $2, version = $3, updated_at = now() WHERE id = $4`,
        [input.name, input.description ?? null, nextVersion, id],
      );

      await client.query(`DELETE FROM workflow_nodes WHERE workflow_id = $1`, [id]);
      await client.query(`DELETE FROM workflow_edges WHERE workflow_id = $1`, [id]);

      for (const n of input.nodes) {
        await client.query(
          `INSERT INTO workflow_nodes (workflow_id, node_id, registered_node_id, name, config_override, position_x, position_y)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, n.nodeId, n.registeredNodeId, n.name ?? null, JSON.stringify(n.configOverride ?? {}), n.positionX ?? 0, n.positionY ?? 0],
        );
      }

      for (const e of input.edges) {
        await client.query(
          `INSERT INTO workflow_edges (workflow_id, from_node, to_node, condition_expression)
           VALUES ($1, $2, $3, $4)`,
          [id, e.from, e.to, e.conditionExpression ?? null],
        );
      }

      await client.query("COMMIT");
      return { id, name: input.name, description: input.description ?? null, version: nextVersion, created_at: new Date(), updated_at: new Date() };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
