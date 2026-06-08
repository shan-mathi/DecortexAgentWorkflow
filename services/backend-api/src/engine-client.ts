// Typed HTTP client for the Workflow Engine (Fargate) service.
//
// The Backend API is a thin proxy — it does NOT hold business logic.
// This client forwards validated requests to the engine and returns
// the engine's response. If the engine is down or returns errors,
// the client surfaces them as-is with appropriate HTTP status codes.
//
// Configuration: WORKFLOW_ENGINE_URL env var (defaults to localhost:4000
// for local dev; in prod this points to the Fargate service's ALB/DNS).

export interface EngineClientConfig {
  baseUrl: string;
  timeoutMs?: number;
}

export class EngineClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config?: Partial<EngineClientConfig>) {
    this.baseUrl = config?.baseUrl ?? process.env.WORKFLOW_ENGINE_URL ?? "http://localhost:4000";
    this.timeoutMs = config?.timeoutMs ?? 30000;
  }

  async forward(method: string, path: string, body?: unknown, requestId?: string): Promise<EngineResponse> {
    const url = `${this.baseUrl}${path}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);

    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (requestId) headers["x-request-id"] = requestId;

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });

      const text = await res.text();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }

      return { status: res.status, data };
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        return { status: 504, data: { error: "EngineTimeout", message: "Workflow engine did not respond in time." } };
      }
      return { status: 502, data: { error: "EngineUnavailable", message: (err as Error).message } };
    } finally {
      clearTimeout(timer);
    }
  }

  // Convenience methods
  async get(path: string): Promise<EngineResponse> {
    return this.forward("GET", path);
  }

  async post(path: string, body: unknown): Promise<EngineResponse> {
    return this.forward("POST", path, body);
  }

  async put(path: string, body: unknown): Promise<EngineResponse> {
    return this.forward("PUT", path, body);
  }
}

export interface EngineResponse {
  status: number;
  data: unknown;
}
