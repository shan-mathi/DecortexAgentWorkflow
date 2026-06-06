// In-memory `WorkflowRepo` and `RunRepo` implementations.
//
// Used by unit/integration tests that exercise `runWorkflow` end-to-end
// without spinning up Postgres. The Postgres-backed versions live in
// `packages/storage` and are tested separately with Testcontainers.
//
// `appendNodeExecution` enforces idempotence on `(runId, nodeId)` —
// matching the design's "second write is a no-op" contract used by
// retry semantics. We store both the META row and the NODE rows so
// `getRun` returns the exact `RunTrace` shape the API expects.

import { randomUUID } from "node:crypto";

import type {
  NodeExecution,
  RunStatus,
  RunSummary,
  RunTrace,
  WorkflowDef,
} from "@workflow-engine/shared";

import type { RunRepo, Workflow, WorkflowRepo } from "../repo.js";

export class InMemoryWorkflowRepo implements WorkflowRepo {
  private readonly defs = new Map<string, WorkflowDef>();
  private readonly meta = new Map<string, Workflow>();

  async create(def: WorkflowDef): Promise<Workflow> {
    const id = def.id ?? randomUUID();
    const stored: WorkflowDef = { ...def, id, version: 1 };
    this.defs.set(id, stored);
    const w: Workflow = { id, name: def.name, version: 1 };
    this.meta.set(id, w);
    return w;
  }

  async list(): Promise<Workflow[]> {
    return Array.from(this.meta.values());
  }

  async get(id: string): Promise<WorkflowDef> {
    const def = this.defs.get(id);
    if (!def) throw new Error(`Workflow not found: ${id}`);
    return def;
  }

  async update(id: string, def: WorkflowDef): Promise<Workflow> {
    const prior = this.meta.get(id);
    if (!prior) throw new Error(`Workflow not found: ${id}`);
    const next: Workflow = {
      id,
      name: def.name,
      version: prior.version + 1,
    };
    this.meta.set(id, next);
    this.defs.set(id, { ...def, id, version: next.version });
    return next;
  }
}

interface RunMeta {
  meta: RunSummary;
}

export class InMemoryRunRepo implements RunRepo {
  private readonly runs = new Map<string, RunMeta>();
  private readonly nodes = new Map<string, Map<string, NodeExecution>>();

  async createRun(run: { runId: string; workflowId: string; input: unknown }): Promise<void> {
    this.runs.set(run.runId, {
      meta: {
        runId: run.runId,
        workflowId: run.workflowId,
        status: "PENDING",
        startedAt: new Date(),
        endedAt: null,
        input: run.input,
      },
    });
    this.nodes.set(run.runId, new Map());
  }

  async setRunStatus(runId: string, status: RunStatus, endedAt?: Date): Promise<void> {
    const r = this.runs.get(runId);
    if (!r) throw new Error(`Run not found: ${runId}`);
    r.meta = {
      ...r.meta,
      status,
      endedAt: endedAt ?? r.meta.endedAt ?? null,
    };
  }

  async appendNodeExecution(runId: string, ne: NodeExecution): Promise<void> {
    const m = this.nodes.get(runId);
    if (!m) throw new Error(`Run not found: ${runId}`);
    if (m.has(ne.nodeId)) return; // idempotent — no duplicate, no throw
    m.set(ne.nodeId, ne);
  }

  async getRun(runId: string): Promise<RunTrace> {
    const r = this.runs.get(runId);
    if (!r) throw new Error(`Run not found: ${runId}`);
    return {
      meta: r.meta,
      nodeExecutions: Array.from((this.nodes.get(runId) ?? new Map()).values()),
    };
  }

  async listRuns(workflowId: string): Promise<RunSummary[]> {
    return Array.from(this.runs.values())
      .map((r) => r.meta)
      .filter((m) => m.workflowId === workflowId)
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  }
}
