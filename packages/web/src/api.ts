// Typed API client. Every endpoint goes through one `request` helper
// that throws on non-2xx so React Query / useEffect callers don't
// need to remember to check `res.ok`.

import type {
  RunSummary,
  RunTrace,
  WorkflowDef,
} from "@workflow-engine/shared";

export interface WorkflowMeta {
  id: string;
  name: string;
  version: number;
}

export interface NodeTypeInfo {
  type: string;
  displayName: string;
  description: string;
  category: "ai" | "io" | "control" | "data";
  configSchema: unknown;
}

const BASE = "/api";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  listWorkflows: () => request<WorkflowMeta[]>("GET", "/workflows"),
  getWorkflow: (id: string) => request<WorkflowDef>("GET", `/workflows/${id}`),
  createWorkflow: (def: WorkflowDef) => request<WorkflowMeta>("POST", "/workflows", def),
  updateWorkflow: (id: string, def: WorkflowDef) =>
    request<WorkflowMeta>("PUT", `/workflows/${id}`, def),
  triggerRun: (id: string, input: unknown) =>
    request<{ runId: string; status: "PENDING" }>(
      "POST",
      `/workflows/${id}/runs`,
      { input },
    ),
  getRun: (runId: string) => request<RunTrace>("GET", `/runs/${runId}`),
  listRuns: (workflowId: string) =>
    request<RunSummary[]>("GET", `/workflows/${workflowId}/runs`),
  listNodeTypes: () => request<NodeTypeInfo[]>("GET", "/node-types"),
};
