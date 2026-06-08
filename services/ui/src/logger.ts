// Client-side logger for the UI.
//
// In development: logs to browser console with structured data.
// In production: could be extended to ship logs to CloudWatch RUM,
// Datadog, or any log aggregator via a beacon endpoint.
//
// Captures:
//   - API request/response timing
//   - API errors (status, URL, response body preview)
//   - User actions (navigation, workflow trigger, etc.)

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL = (import.meta.env.VITE_LOG_LEVEL ?? "info") as LogLevel;
const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[LOG_LEVEL];
}

function emit(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: "ui",
    msg,
    ...data,
  };
  switch (level) {
    case "error":
      console.error("[UI]", msg, entry);
      break;
    case "warn":
      console.warn("[UI]", msg, entry);
      break;
    case "debug":
      console.debug("[UI]", msg, entry);
      break;
    default:
      console.log("[UI]", msg, entry);
  }
}

export const uiLogger = {
  debug: (msg: string, data?: Record<string, unknown>) => emit("debug", msg, data),
  info: (msg: string, data?: Record<string, unknown>) => emit("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => emit("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => emit("error", msg, data),
};
