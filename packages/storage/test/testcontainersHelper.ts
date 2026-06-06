// Helper that spins up a Postgres+pgvector container, applies the
// migrations, and returns a Drizzle handle.
//
// We use the `pgvector/pgvector:pg16` image (official) so the
// `CREATE EXTENSION vector` in the migration succeeds.
//
// `dockerAvailable()` returns false in environments without Docker so
// the test files using this helper can mark themselves skipped
// instead of crashing the whole suite. CI / reviewers running
// `docker compose up` will get the real container path.

import { execSync } from "node:child_process";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";

import { migrate } from "../src/migrate.js";

export function dockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export interface PgHarness {
  db: NodePgDatabase;
  pool: pg.Pool;
  stop: () => Promise<void>;
}

export async function startPg(): Promise<PgHarness> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    "pgvector/pgvector:pg16",
  ).start();

  const pool = new pg.Pool({
    connectionString: container.getConnectionUri(),
  });

  await migrate(pool);
  const db = drizzle(pool);

  return {
    db,
    pool,
    async stop() {
      await pool.end();
      await container.stop();
    },
  };
}
