// HTTP node — calls an external REST API with a templated url and body.
//
// Non-2xx responses throw so the retry wrapper applies the configured
// policy. We deliberately do not parse JSON for the caller — `body` is
// returned as a string so workflow authors can decide whether to JSON.parse
// downstream (typically via a Transform node).

import { z } from "zod";

import type { NodeContext, NodeResult } from "@workflow-engine/shared";

import type { NodeExecutor } from "../registry.js";
import { resolveTemplate } from "../template.js";

export const HTTPConfigSchema = z
  .object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).optional(),
    bodyTemplate: z.string().optional(),
    timeoutMs: z.number().int().positive().default(30000),
    retry: z
      .object({
        maxAttempts: z.number().int().positive(),
        backoffMs: z.number().int().nonnegative(),
        jitter: z.number().min(0).max(1),
      })
      .partial()
      .optional(),
    terminalOnFailure: z.boolean().optional(),
  })
  .strict();

export type HTTPConfig = z.infer<typeof HTTPConfigSchema>;

export class HTTPNode implements NodeExecutor<HTTPConfig> {
  readonly type = "http";
  readonly displayName = "HTTP Request";
  readonly description = "Call an external REST API; non-2xx responses retry.";
  readonly category = "io" as const;
  readonly configSchema = HTTPConfigSchema;

  async execute(config: HTTPConfig, ctx: NodeContext): Promise<NodeResult> {
    const url = resolveTemplate(config.url, ctx);
    const init: RequestInit = {
      method: config.method,
      headers: config.headers,
    };
    if (config.bodyTemplate && config.method !== "GET") {
      init.body = resolveTemplate(config.bodyTemplate, ctx);
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), config.timeoutMs);
    init.signal = ctrl.signal;

    try {
      const res = await fetch(url, init);
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      return {
        output: { status: res.status, body: text },
        status: "SUCCEEDED",
        durationMs: 0,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
