// HTTP Node Handler — calls external REST APIs.

import type { NodeContext, NodeResult } from "../../types/index.js";

import { resolveTemplate } from "../../executor/template.js";
import type { NodeHandler } from "../node-handler.js";

interface HTTPConfig {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  bodyTemplate?: string;
  timeoutMs?: number;
}

export class HTTPHandler implements NodeHandler {
  readonly category = "http";

  async execute(config: unknown, ctx: NodeContext): Promise<NodeResult> {
    const cfg = config as HTTPConfig;
    const url = resolveTemplate(cfg.url, ctx);
    const method = cfg.method ?? "GET";
    const timeoutMs = cfg.timeoutMs ?? 30000;

    const init: RequestInit = { method, headers: cfg.headers };
    if (cfg.bodyTemplate && method !== "GET") {
      init.body = resolveTemplate(cfg.bodyTemplate, ctx);
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    init.signal = ctrl.signal;

    try {
      const res = await fetch(url, init);
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      return { output: { status: res.status, body: text }, status: "SUCCEEDED", durationMs: 0 };
    } finally {
      clearTimeout(timer);
    }
  }
}
