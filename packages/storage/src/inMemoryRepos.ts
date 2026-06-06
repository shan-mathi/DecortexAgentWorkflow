// In-memory implementations of RunRepo and WorkflowRepo for testing
// without Docker. These store data in memory and satisfy the same
// interfaces as the Postgres implementations.

import { randomUUID } from "node:crypto";

import type { RunRepo, Workflow, WorkflowRepo } from "@workflow-engine/engine";
import type {
  NodeExecution,
  RunStatus,
  RunSummary,
  RunTrace,
  WorkflowDef,
} from "@workflow-engine/shared";

export class InMemoryWorkflowRepo implements WorkflowRepo {
  private workflows = new Map<string, { def: WorkflowDef; version: number; createdAt: Date }>();

  async create(def: WorkflowDef): Promise<Workflow> {
    const id = def.id ?? randomUUID();
    this.workflows.set(id, { def: { ...def, id }, version: 1, createdAt: new Date() });
    return { id, name: def.name, version: 1 };
  }

  async list(): Promise<Workflow[]> {
    return Array.from(this.workflows.values()).map((w) => ({
      id: w.def.id!,
      name: w.def.name,
      version: w.version,
    }));
  }

  async get(id: string): Promise<WorkflowDef> {
    const w = this.workflows.get(id);
    if (!w) throw new Error(`Workflow ${id} not found`);
    return w.def;
  }

  async update(id: string, def: WorkflowDef): Promise<Workflow> {
    const w = this.workflows.get(id);
    if (!w) throw new Error(`Workflow ${id} not found`);
    const newVersion = w.version + 1;
    this.workflows.set(id, { def: { ...def, id }, version: newVersion, createdAt: w.createdAt });
    return { id, name: def.name, version: newVersion };
  }
}

export class InMemoryRunRepo implements RunRepo {
  private runs = new Map<
    string,
    {
      runId: string;
      workflowId: string;
      status: RunStatus;
      input: unknown;
      startedAt: Date;
      endedAt?: Date;
    }
  >();

  private nodeExecutions = new Map<
    string,
    {
      runId: string;
      nodeId: string;
      execution: NodeExecution;
    }
  >();

  async createRun(run: { runId: string; workflowId: string; input: unknown }): Promise<void> {
    this.runs.set(run.runId, {
      runId: run.runId,
      workflowId: run.workflowId,
      status: "PENDING",
      input: run.input,
      startedAt: new Date(),
    });
  }

  async setRunStatus(runId: string, status: RunStatus, endedAt?: Date): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    run.status = status;
    if (endedAt) run.endedAt = endedAt;
  }

  async appendNodeExecution(runId: string, ne: NodeExecution): Promise<void> {
    const key = `${runId}:${ne.nodeId}`;
    // Idempotent: only insert if not already present
    if (!this.nodeExecutions.has(key)) {
      this.nodeExecutions.set(key, { runId, nodeId: ne.nodeId, execution: ne });
    }
  }

  async getRun(runId: string): Promise<RunTrace> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run ${runId} not found`);

    const nodeExecutions = Array.from(this.nodeExecutions.values())
      .filter((ne) => ne.runId === runId)
      .map((ne) => ne.execution);

    return {
      meta: {
        runId: run.runId,
        workflowId: run.workflowId,
        status: run.status,
        input: run.input,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
      },
      nodeExecutions,
    };
  }

  async listRuns(workflowId: string): Promise<RunSummary[]> {
    return Array.from(this.runs.values())
      .filter((r) => r.workflowId === workflowId)
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
      .map((r) => ({
        runId: r.runId,
        workflowId: r.workflowId,
        status: r.status,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
      }));
  }
}
