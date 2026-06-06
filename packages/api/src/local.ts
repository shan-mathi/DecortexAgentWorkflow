// Local entry point: `tsx watch src/local.ts` (or `pnpm dev`).
//
// Wires the Fastify API, the in-process executor, and Postgres repos.
// LLM provider defaults to FakeLLM unless `LLM_PROVIDER` is set; the
// brief allows that and it keeps `pnpm dev` API-key-free.

import pg from "pg";

import { drizzle } from "drizzle-orm/node-postgres";

import { FakeLLM } from "@workflow-engine/fake-llm";
import {
  NodeRegistry,
  registerNodes,
  runWorkflow,
  type QueryRunner,
} from "@workflow-engine/engine";
import type { LLMProvider } from "@workflow-engine/shared";
import {
  RunRepoPostgres,
  WorkflowRepoPostgres,
  migrate,
} from "@workflow-engine/storage";

import { buildApp } from "./app.js";
import { makeLocalRunner } from "./runRunner.js";

function pickLlm(): LLMProvider {
  const kind = process.env.LLM_PROVIDER ?? "fake";
  switch (kind) {
    case "fake":
      return new FakeLLM({ embeddingDim: 1536 });
    default:
      throw new Error(
        `LLM_PROVIDER=${kind} not yet wired in the local entry. Use LLM_PROVIDER=fake.`,
      );
  }
}

async function main() {
  const url =
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
  const pool = new pg.Pool({ connectionString: url });
  await migrate(pool);

  const db = drizzle(pool);
  const workflowRepo = new WorkflowRepoPostgres(db);
  const runRepo = new RunRepoPostgres(db);
  const llm = pickLlm();

  const queryRunner: QueryRunner = {
    query: async (sql, params) => {
      const r = await pool.query(sql, params);
      return { rows: r.rows };
    },
  };

  const registry = new NodeRegistry();
  registerNodes(registry, { llm, db: queryRunner });

  const runner = makeLocalRunner(async ({ runId, workflowId, input }) => {
    const def = await workflowRepo.get(workflowId);
    await runWorkflow(def, input, runId, { registry, runRepo });
  });

  const app = await buildApp({
    workflowRepo,
    runRepo,
    registry,
    runner,
    logger: true,
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: "0.0.0.0" });
  // eslint-disable-next-line no-console
  console.log(`[api] listening on http://localhost:${port}`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
