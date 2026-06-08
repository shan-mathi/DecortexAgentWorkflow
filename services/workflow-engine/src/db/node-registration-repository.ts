// NodeRegistrationRepository — all DB operations for registered nodes.

import { randomUUID } from "node:crypto";

import type pg from "pg";

export interface RegisteredNodeRow {
  id: string;
  name: string;
  node_type_id: string;
  category: string;
  description: string | null;
  config: unknown;
  version: string;
  created_at: Date;
  updated_at: Date;
}

export class NodeRegistrationRepository {
  constructor(private readonly pool: pg.Pool) {}

  async create(input: {
    name: string;
    nodeTypeId: string;
    category: string;
    description?: string;
    config: unknown;
    version?: string;
  }): Promise<RegisteredNodeRow> {
    const id = randomUUID();
    const { rows } = await this.pool.query<RegisteredNodeRow>(
      `INSERT INTO registered_nodes (id, name, node_type_id, category, description, config, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        id,
        input.name,
        input.nodeTypeId,
        input.category,
        input.description ?? null,
        JSON.stringify(input.config),
        input.version ?? "1.0.0",
      ],
    );
    return rows[0]!;
  }

  async list(): Promise<RegisteredNodeRow[]> {
    const { rows } = await this.pool.query<RegisteredNodeRow>(
      `SELECT * FROM registered_nodes ORDER BY name`,
    );
    return rows;
  }

  async getById(id: string): Promise<RegisteredNodeRow | null> {
    const { rows } = await this.pool.query<RegisteredNodeRow>(
      `SELECT * FROM registered_nodes WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async getByIds(ids: string[]): Promise<Map<string, RegisteredNodeRow>> {
    if (ids.length === 0) return new Map();
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
    const { rows } = await this.pool.query<RegisteredNodeRow>(
      `SELECT * FROM registered_nodes WHERE id IN (${placeholders})`,
      ids,
    );
    return new Map(rows.map((r) => [r.id, r]));
  }

  async listByType(nodeTypeId: string): Promise<RegisteredNodeRow[]> {
    const { rows } = await this.pool.query<RegisteredNodeRow>(
      `SELECT * FROM registered_nodes WHERE node_type_id = $1 ORDER BY name`,
      [nodeTypeId],
    );
    return rows;
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM registered_nodes WHERE id = $1`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  }
}
