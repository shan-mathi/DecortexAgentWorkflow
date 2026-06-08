// Node execution types — the I/O contract for all node handlers.

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export type NodeStatus = "SUCCEEDED" | "FAILED" | "SKIPPED";

export interface NodeError {
  message: string;
  stack?: string;
}

export interface NodeResult {
  output: unknown;
  status: NodeStatus;
  error?: NodeError;
  durationMs: number;
  tokenUsage?: TokenUsage;
}

export interface NodeContext {
  runId: string;
  nodeId: string;
  runInput: unknown;
  upstream: Record<string, NodeResult>;
  metadata: { workflowId: string; attempt: number };
}
