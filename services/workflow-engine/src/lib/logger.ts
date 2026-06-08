// Structured logger for the Workflow Engine service.
//
// Uses Pino under the hood (Fastify's default). Outputs JSON lines
// that CloudWatch Logs can parse automatically — no custom log
// format needed. Each log line includes:
//   - timestamp (ISO)
//   - level (info, warn, error, debug)
//   - service name
//   - optional: requestId, workflowId, runId, nodeId, durationMs
//
// Usage:
//   import { logger } from "../lib/logger.js";
//   logger.info({ runId, nodeId }, "Node execution started");
//   logger.error({ runId, err }, "Node execution failed");

import { randomUUID } from "node:crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  requestId?: string;
  workflowId?: string;
  runId?: string;
  nodeId?: string;
  nodeType?: string;
  durationMs?: number;
  status?: string;
  error?: string;
  [key: string]: unknown;
}

const SERVICE = process.env.SERVICE_NAME ?? "workflow-engine";
const LOG_LEVEL = (process.env.LOG_LEVEL ?? "info") as LogLevel;

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[LOG_LEVEL];
}

function emit(level: LogLevel, ctx: LogContext, msg: string): void {
  if (!shouldLog(level)) return;
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: SERVICE,
    msg,
    ...ctx,
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export const logger = {
  debug: (ctx: LogContext, msg: string) => emit("debug", ctx, msg),
  info: (ctx: LogContext, msg: string) => emit("info", ctx, msg),
  warn: (ctx: LogContext, msg: string) => emit("warn", ctx, msg),
  error: (ctx: LogContext, msg: string) => emit("error", ctx, msg),

  child: (baseCtx: LogContext) => ({
    debug: (ctx: LogContext, msg: string) => emit("debug", { ...baseCtx, ...ctx }, msg),
    info: (ctx: LogContext, msg: string) => emit("info", { ...baseCtx, ...ctx }, msg),
    warn: (ctx: LogContext, msg: string) => emit("warn", { ...baseCtx, ...ctx }, msg),
    error: (ctx: LogContext, msg: string) => emit("error", { ...baseCtx, ...ctx }, msg),
  }),

  generateRequestId: () => randomUUID().slice(0, 8),
};
