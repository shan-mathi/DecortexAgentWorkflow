// Workflow Service — business logic for workflow definitions.
// Delegates all DB access to WorkflowRepository.

import type {
  CreateWorkflowInput,
  WorkflowFull,
  WorkflowRepository,
  WorkflowRow,
} from "../db/workflow-repository.js";

export type { WorkflowFull } from "../db/workflow-repository.js";

export class WorkflowService {
  constructor(private readonly repo: WorkflowRepository) {}

  async create(input: CreateWorkflowInput): Promise<WorkflowRow> {
    return this.repo.create(input);
  }

  async list(): Promise<WorkflowRow[]> {
    return this.repo.list();
  }

  async getById(id: string): Promise<WorkflowFull | null> {
    return this.repo.getById(id);
  }

  async update(id: string, input: CreateWorkflowInput): Promise<WorkflowRow> {
    return this.repo.update(id, input);
  }

  async delete(id: string): Promise<boolean> {
    return this.repo.delete(id);
  }
}
