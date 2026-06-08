// Database connection and migration runner.
//
// Connection modes:
//   1. Local dev: reads DATABASE_URL env var (default: local postgres)
//   2. AWS Fargate: reads DB_SECRET_ARN (JSON from Secrets Manager
//      injected by ECS) + DB_HOST/DB_PORT/DB_NAME env vars.
//
// The pool is created lazily on first `getPool()` call.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { logger } from "../lib/logger.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const MIGRATIONS_DIR = join(here, "..", "..", "migrations");

let pool: pg.Pool | null = null;

function buildConnectionConfig(): pg.PoolConfig {
  // Mode 1: explicit DATABASE_URL (local dev, CI)
  if (process.env.DATABASE_URL) {
    logger.info({}, "Using DATABASE_URL for DB connection");
    return { connectionString: process.env.DATABASE_URL, max: 20 };
  }

  // Mode 2: AWS Secrets Manager secret (Fargate)
  // ECS injects the secret as a JSON string in the env var DB_SECRET_ARN.
  const secretJson = process.env.DB_SECRET_ARN;
  if (secretJson) {
    try {
      const secret = JSON.parse(secretJson) as {
        username: string;
        password: string;
        host?: string;
        port?: number;
        dbname?: string;
      };
      const host = secret.host ?? process.env.DB_HOST ?? "localhost";
      const port = secret.port ?? Number(process.env.DB_PORT ?? "5432");
      const database = secret.dbname ?? process.env.DB_NAME ?? "agentengine";
      logger.info({ host, port, database, user: secret.username }, "Using AWS secret for DB connection");
      return {
        host,
        port,
        database,
        user: secret.username,
        password: secret.password,
        max: 20,
        ssl: { rejectUnauthorized: false },
      };
    } catch {
      logger.warn({}, "DB_SECRET_ARN is set but not valid JSON, falling back to individual env vars");
    }
  }

  // Mode 3: individual env vars (manual config)
  const host = process.env.DB_HOST ?? "localhost";
  const port = Number(process.env.DB_PORT ?? "5432");
  const database = process.env.DB_NAME ?? "postgres";
  const user = process.env.DB_USER ?? "postgres";
  const password = process.env.DB_PASSWORD ?? "postgres";
  logger.info({ host, port, database, user }, "Using individual env vars for DB connection");
  return { host, port, database, user, password, max: 20 };
}

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool(buildConnectionConfig());
  }
  return pool;
}

export async function migrate(): Promise<void> {
  const p = getPool();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  logger.info({ migrationCount: files.length }, "Running migrations");
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    await p.query(sql);
  }
  logger.info({}, "Migrations complete");
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
