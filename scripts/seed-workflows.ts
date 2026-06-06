#!/usr/bin/env -S node --import tsx
// Seeds the local Postgres with the ops-ticket-router workflow (and
// any future fixtures). Idempotent on workflow id — re-running with
// the same fixture overwrites the existing definition.
//
// Usage:
//   pnpm seed:workflows

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { WorkflowRepoPostgres, migrate } from "@workflow-engine/storage";
import type { WorkflowDef } from "@workflow-engine/shared";

async function main() {
  const url =
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
  const pool = new pg.Pool({ connectionString: url });
  await migrate(pool);
  const repo = new WorkflowRepoPostgres(drizzle(pool));

  const dir = join(process.cwd(), "fixtures", "workflows");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

  for (const f of files) {
    const def = JSON.parse(readFileSync(join(dir, f), "utf8")) as WorkflowDef;
    if (!def.id) {
      console.error(`[seed-workflows] ${f} has no id; skipping`);
      continue;
    }
    try {
      await repo.get(def.id);
      // Exists → update.
      await repo.update(def.id, def);
      console.log(`[seed-workflows] updated ${def.name} (${def.id})`);
    } catch {
      await repo.create(def);
      console.log(`[seed-workflows] created ${def.name} (${def.id})`);
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
