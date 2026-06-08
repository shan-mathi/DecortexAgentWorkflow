// Node Registration Service — business logic for registered nodes.
// Delegates all DB access to NodeRegistrationRepository.

import type { NodeRegistrationRepository, RegisteredNodeRow } from "../db/node-registration-repository.js";

export type { RegisteredNodeRow } from "../db/node-registration-repository.js";

export class NodeRegistrationService {
  constructor(private readonly repo: NodeRegistrationRepository) {}

  async register(input: {
    name: string;
    nodeTypeId: string;
    category: string;
    description?: string;
    config: unknown;
    version?: string;
  }): Promise<RegisteredNodeRow> {
    return this.repo.create(input);
  }

  async list(): Promise<RegisteredNodeRow[]> {
    return this.repo.list();
  }

  async getById(id: string): Promise<RegisteredNodeRow | null> {
    return this.repo.getById(id);
  }

  async listByType(nodeTypeId: string): Promise<RegisteredNodeRow[]> {
    return this.repo.listByType(nodeTypeId);
  }

  async delete(id: string): Promise<boolean> {
    return this.repo.delete(id);
  }
}
