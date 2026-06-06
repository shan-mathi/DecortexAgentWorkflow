// Tiny migration runner — reads every `*.sql` file from
// `migrations/` and executes it. We don't track applied migrations
// because the workload (a take-home + ephemeral dev DB) doesn't need
// the bookkeeping. Reviewers can `docker compose down -v` and re-run.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Pool } from "pg";

const here = fileURLToPath(new URL(".", import.meta.url));
const MIGRATIONS_DIR = join(here, "..", "migrations");

export async function migrate(pool: Pool): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    await pool.query(sql);
  }
}
