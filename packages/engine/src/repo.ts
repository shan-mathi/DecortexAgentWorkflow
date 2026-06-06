// Repository interfaces consumed by the engine.
//
// Two implementations of `RunRepo` exist (Postgres locally, DynamoDB in
// AWS); two implementations of `WorkflowRepo` exist in principle (only
// Postgres ships today). The engine never knows which one it has.
//
// "Idempotent on (runId, nodeId)" is the load-bearing property of
// `appendNodeExecution`: a retried executor invocation must never
// produce two persisted rows for the same node, otherwise the run
// trace becomes ambiguous.

import type {
  NodeExecution,
  RunStatus,
  RunSummary,
  RunTrace,
  WorkflowDef,
} from "@workflow-engine/shared";

export interface Workflow {
  id: string;
  name: string;
  version: number;
}

export interface WorkflowRepo {
  create(def: WorkflowDef): Promise<Workflow>;
  list(): Promise<Workflow[]>;
  get(id: string): Promise<WorkflowDef>;
  update(id: string, def: WorkflowDef): Promise<Workflow>;
}

export interface RunRepo {
  createRun(run: {
    runId: string;
    workflowId: string;
    input: unknown;
  }): Promise<void>;
  setRunStatus(runId: string, status: RunStatus, endedAt?: Date): Promise<void>;
  /**
   * Idempotent on `(runId, nodeId)`. Repeated calls with the same pair
   * MUST be either no-ops or rejected without raising; the engine relies
   * on this for retry safety.
   */
  appendNodeExecution(runId: string, ne: NodeExecution): Promise<void>;
  getRun(runId: string): Promise<RunTrace>;
  listRuns(workflowId: string): Promise<RunSummary[]>;
}
