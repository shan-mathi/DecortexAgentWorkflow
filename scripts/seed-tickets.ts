#!/usr/bin/env -S node --import tsx
// Loads `fixtures/tickets/seed.json` into `tickets_seed`, embedding
// each row via the configured LLMProvider.
//
// Idempotent: the script truncates `tickets_seed` before inserting so
// re-running gives a clean corpus. The deterministic retrieval test
// depends on this ordering.
//
// Usage:
//   pnpm seed:tickets                 # uses LLM_PROVIDER (defaults to fake)
//   DATABASE_URL=... pnpm seed:tickets

import { readFileSync } from "node:fs";
import { join } from "node:path";

import pg from "pg";

import { FakeLLM } from "@workflow-engine/fake-llm";
import type { LLMProvider } from "@workflow-engine/shared";

interface Ticket {
  id: string;
  subject: string;
  body: string;
  resolution: string;
  urgency: string;
}

function pickProvider(): LLMProvider {
  const kind = process.env.LLM_PROVIDER ?? "fake";
  if (kind !== "fake") {
    throw new Error(
      `seed-tickets only supports LLM_PROVIDER=fake today (got "${kind}"). The real-provider seeder is a next-week item.`,
    );
  }
  return new FakeLLM({ embeddingDim: 1536 });
}

async function main() {
  const url =
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
  const pool = new pg.Pool({ connectionString: url });
  const llm = pickProvider();

  const fixturePath = join(process.cwd(), "fixtures", "tickets", "seed.json");
  const tickets: Ticket[] = JSON.parse(readFileSync(fixturePath, "utf8"));

  console.log(`[seed] loaded ${tickets.length} tickets`);

  await pool.query("TRUNCATE TABLE tickets_seed");

  for (const t of tickets) {
    const text = `${t.subject}\n${t.body}`;
    const { vector } = await llm.embed({ text });
    const vec = `[${vector.join(",")}]`;
    await pool.query(
      `INSERT INTO tickets_seed (id, subject, body, resolution, urgency, embedding)
       VALUES ($1, $2, $3, $4, $5, $6::vector)`,
      [t.id, t.subject, t.body, t.resolution, t.urgency, vec],
    );
  }

  await pool.end();
  console.log("[seed] done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
