// NodeTypeRepository — all DB operations for node type templates.

import { randomUUID } from "node:crypto";

import type pg from "pg";

export interface NodeTypeRow {
  id: string;
  name: string;
  category: string;
  description: string | null;
  version: string;
  config_schema: unknown;
  created_at: Date;
  updated_at: Date;
}

export class NodeTypeRepository {
  constructor(private readonly pool: pg.Pool) {}

  async create(input: {
    name: string;
    category: string;
    description?: string;
    configSchema?: unknown;
  }): Promise<NodeTypeRow> {
    const id = randomUUID();
    const { rows } = await this.pool.query<NodeTypeRow>(
      `INSERT INTO node_types (id, name, category, description, config_schema)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, input.name, input.category, input.description ?? null, JSON.stringify(input.configSchema ?? {})],
    );
    return rows[0]!;
  }

  async list(): Promise<NodeTypeRow[]> {
    const { rows } = await this.pool.query<NodeTypeRow>(
      `SELECT * FROM node_types ORDER BY name`,
    );
    return rows;
  }

  async getById(id: string): Promise<NodeTypeRow | null> {
    const { rows } = await this.pool.query<NodeTypeRow>(
      `SELECT * FROM node_types WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async getByName(name: string): Promise<NodeTypeRow | null> {
    const { rows } = await this.pool.query<NodeTypeRow>(
      `SELECT * FROM node_types WHERE name = $1`,
      [name],
    );
    return rows[0] ?? null;
  }
}
