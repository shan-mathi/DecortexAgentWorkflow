// Structured logger for the Backend API service.
// Same contract as workflow-engine logger — JSON lines, CloudWatch-compatible.

import { randomUUID } from "node:crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  requestId?: string;
  method?: string;
  url?: string;
  statusCode?: number;
  durationMs?: number;
  error?: string;
  [key: string]: unknown;
}

const SERVICE = process.env.SERVICE_NAME ?? "backend-api";
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
  generateRequestId: () => randomUUID().slice(0, 8),
};
