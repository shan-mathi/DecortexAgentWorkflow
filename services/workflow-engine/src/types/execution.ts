// Execution types — run lifecycle and per-node trace records.

import type { NodeError, NodeStatus, TokenUsage } from "./node.js";

export type RunStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";

export interface NodeExecution {
  nodeId: string;
  registeredNodeId?: string;
  nodeName?: string;
  nodeType?: string;
  input: unknown;
  output: unknown;
  status: NodeStatus;
  durationMs: number;
  error?: NodeError;
  attemptCount: number;
  startedAt: Date;
  tokenUsage?: TokenUsage;
}

export interface RunSummary {
  runId: string;
  workflowId: string;
  status: RunStatus;
  startedAt: Date;
  endedAt: Date | null;
  input: unknown;
}

export interface RunTrace {
  meta: RunSummary;
  nodeExecutions: NodeExecution[];
}
