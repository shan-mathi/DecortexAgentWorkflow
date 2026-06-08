// Node Type Service — business logic for node type templates.
// Delegates all DB access to NodeTypeRepository.

import type { NodeTypeRepository, NodeTypeRow } from "../db/node-type-repository.js";

export class NodeTypeService {
  constructor(private readonly repo: NodeTypeRepository) {}

  async create(input: {
    name: string;
    category: string;
    description?: string;
    configSchema?: unknown;
  }): Promise<NodeTypeRow> {
    return this.repo.create(input);
  }

  async list(): Promise<NodeTypeRow[]> {
    return this.repo.list();
  }

  async getById(id: string): Promise<NodeTypeRow | null> {
    return this.repo.getById(id);
  }

  async getByName(name: string): Promise<NodeTypeRow | null> {
    return this.repo.getByName(name);
  }
}
