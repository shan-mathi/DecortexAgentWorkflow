// Typed API client for the Backend API.
// All calls go through /api/* which the Vite proxy forwards to port 3000.

import { uiLogger } from "./logger.js";

// In local dev: Vite proxies /api/* to localhost:3000/api/*
// In production: set VITE_API_URL to the API Gateway endpoint
// BASE always ends without a trailing slash; paths below start with /api/...
const BASE = import.meta.env.VITE_API_URL ?? "";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const start = performance.now();
  const requestId = crypto.randomUUID().slice(0, 8);

  uiLogger.debug(`API ${method} ${path}`, { requestId, body: body ? "present" : "none" });

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      "x-request-id": requestId,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const durationMs = Math.round(performance.now() - start);

  if (!res.ok) {
    const text = await res.text();
    uiLogger.error(`API ${method} ${path} failed`, { requestId, status: res.status, durationMs, response: text.slice(0, 300) });
    throw new Error(`${res.status}: ${text.slice(0, 500)}`);
  }

  uiLogger.info(`API ${method} ${path}`, { requestId, status: res.status, durationMs });
  return res.json() as Promise<T>;
}

// --- Types ---
export interface NodeType {
  id: string;
  name: string;
  category: string;
  description: string | null;
  config_schema: unknown;
}

export interface RegisteredNode {
  id: string;
  name: string;
  node_type_id: string;
  category: string;
  description: string | null;
  config: unknown;
}

export interface WorkflowMeta {
  id: string;
  name: string;
  version: number;
}

export interface WorkflowFull {
  id: string;
  name: string;
  description: string | null;
  version: number;
  nodes: Array<{
    nodeId: string;
    registeredNodeId: string;
    name: string | null;
    configOverride: unknown;
    positionX: number;
    positionY: number;
  }>;
  edges: Array<{
    from: string;
    to: string;
    conditionExpression: string | null;
  }>;
}

export interface RunSummary {
  runId: string;
  workflowId: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  input: unknown;
}

export interface NodeExecution {
  nodeId: string;
  registeredNodeId?: string;
  nodeName?: string;
  nodeType?: string;
  input: unknown;
  output: unknown;
  status: string;
  durationMs: number;
  error?: { message: string };
  attemptCount: number;
  startedAt: string;
  tokenUsage?: { promptTokens: number; completionTokens: number };
}

export interface RunTrace {
  meta: RunSummary;
  nodeExecutions: NodeExecution[];
}

// --- API ---
export const api = {
  // Node Types
  listNodeTypes: () => request<NodeType[]>("GET", "/api/node-types"),
  createNodeType: (body: { name: string; category: string; description?: string; configSchema?: unknown }) =>
    request<NodeType>("POST", "/api/node-types", body),

  // Nodes
  listNodes: () => request<RegisteredNode[]>("GET", "/api/nodes"),
  getNode: (id: string) => request<RegisteredNode>("GET", `/api/nodes/${id}`),
  registerNode: (body: { name: string; nodeTypeId: string; category: string; description?: string; config: unknown }) =>
    request<RegisteredNode>("POST", "/api/nodes", body),
  deleteNode: (id: string) => request<void>("DELETE", `/api/nodes/${id}`),

  // Workflows
  listWorkflows: () => request<WorkflowMeta[]>("GET", "/api/workflows"),
  getWorkflow: (id: string) => request<WorkflowFull>("GET", `/api/workflows/${id}`),
  createWorkflow: (body: unknown) => request<WorkflowMeta>("POST", "/api/workflows", body),
  updateWorkflow: (id: string, body: unknown) => request<WorkflowMeta>("PUT", `/api/workflows/${id}`, body),
  deleteWorkflow: (id: string) => request<void>("DELETE", `/api/workflows/${id}`),

  // Executions
  triggerExecution: (workflowId: string, input: unknown) =>
    request<{ runId: string; status: string }>("POST", "/api/executions", { workflowId, input }),
  getExecution: (runId: string) => request<RunTrace>("GET", `/api/executions/${runId}`),
  listExecutions: (workflowId?: string) =>
    request<RunSummary[]>("GET", workflowId ? `/api/executions?workflowId=${workflowId}` : "/api/executions"),
};
