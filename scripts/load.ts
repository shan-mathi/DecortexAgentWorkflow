#!/usr/bin/env -S node --import tsx
// Load-test script.
//
// Spawns N concurrent runs of the ops-ticket-router workflow against
// the in-process engine using FakeLLM with realistic latency
// distribution and a 1% failure injection rate. Reports throughput
// and per-node P50/P99 duration.
//
// REFUSES to run if `LLM_PROVIDER` is set to anything other than
// `fake` — non-negotiable per the design (we don't burn money on
// load tests).
//
// Usage:
//   pnpm load                              # defaults: --concurrency 10 --total 100
//   pnpm load --concurrency=20 --total=500
//
// Output: a one-page summary table of throughput + P50/P99 + a short
// "expected bottleneck order" comment block.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { FakeLLM } from "@workflow-engine/fake-llm";
import {
  NodeRegistry,
  registerNodes,
  runWorkflow,
  type QueryRunner,
} from "@workflow-engine/engine";
import { InMemoryRunRepo } from "@workflow-engine/engine/testing";
import type { WorkflowDef } from "@workflow-engine/shared";

interface Args {
  concurrency: number;
  total: number;
}

function parseArgs(): Args {
  const args: Args = { concurrency: 10, total: 100 };
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--(\w+)=(\d+)$/);
    if (!m) continue;
    if (m[1] === "concurrency") args.concurrency = Number(m[2]);
    else if (m[1] === "total") args.total = Number(m[2]);
  }
  return args;
}

function refuseRealProvider(): void {
  const p = process.env.LLM_PROVIDER;
  if (p && p !== "fake") {
    console.error(
      `[load] REFUSED: LLM_PROVIDER=${p}. The load script only runs against FakeLLM. Unset LLM_PROVIDER or set it to "fake".`,
    );
    process.exit(2);
  }
}

function fakeRetriever(): QueryRunner {
  return {
    async query() {
      return {
        rows: [
          { id: "f1", subject: "s1", resolution: "r1", urgency: "MED", similarity: 0.9 },
          { id: "f2", subject: "s2", resolution: "r2", urgency: "MED", similarity: 0.8 },
          { id: "f3", subject: "s3", resolution: "r3", urgency: "MED", similarity: 0.7 },
        ],
      };
    },
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

async function main() {
  refuseRealProvider();
  const args = parseArgs();
  console.log(
    `[load] concurrency=${args.concurrency} total=${args.total} provider=fake`,
  );

  const def: WorkflowDef = JSON.parse(
    readFileSync(
      join(process.cwd(), "fixtures", "workflows", "ops-ticket-router.json"),
      "utf8",
    ),
  );
  const llm = new FakeLLM({
    embeddingDim: 16,
    latency: { kind: "exponential", mean: 50 },
    failure: { kind: "rate-limit", rate: 0.01 },
  });
  const registry = new NodeRegistry();
  registerNodes(registry, { llm, db: fakeRetriever() });

  const perNodeDurations = new Map<string, number[]>();
  let succeeded = 0;
  let failed = 0;

  const tStart = Date.now();
  let nextRunIdx = 0;

  async function worker(): Promise<void> {
    while (true) {
      const idx = nextRunIdx++;
      if (idx >= args.total) return;
      const runRepo = new InMemoryRunRepo();
      const runId = randomUUID();
      await runRepo.createRun({
        runId,
        workflowId: def.id ?? "load",
        input: { subject: `load-${idx}`, body: `body-${idx}` },
      });
      const r = await runWorkflow(
        def,
        { subject: `load-${idx}`, body: `body-${idx}` },
        runId,
        { registry, runRepo },
      );
      if (r.status === "SUCCEEDED") succeeded += 1;
      else failed += 1;

      const trace = await runRepo.getRun(runId);
      for (const ne of trace.nodeExecutions) {
        if (!perNodeDurations.has(ne.nodeId)) perNodeDurations.set(ne.nodeId, []);
        perNodeDurations.get(ne.nodeId)!.push(ne.durationMs);
      }
    }
  }

  await Promise.all(Array.from({ length: args.concurrency }, () => worker()));
  const tEnd = Date.now();
  const wallS = (tEnd - tStart) / 1000;
  const throughput = args.total / wallS;

  console.log(`\nWall time   : ${wallS.toFixed(2)}s`);
  console.log(`Throughput  : ${throughput.toFixed(1)} runs/s`);
  console.log(`Outcomes    : ${succeeded} succeeded, ${failed} failed`);

  console.log("\nPer-node duration (ms):");
  console.log("  node             count   P50    P99");
  console.log("  ---------------- ------ ------ ------");
  for (const [nodeId, ds] of perNodeDurations) {
    const sorted = [...ds].sort((a, b) => a - b);
    const p50 = percentile(sorted, 50);
    const p99 = percentile(sorted, 99);
    console.log(
      `  ${nodeId.padEnd(16)} ${String(sorted.length).padStart(6)} ${String(p50).padStart(6)} ${String(p99).padStart(6)}`,
    );
  }

  console.log(`
Expected bottleneck order at higher load:
  1. Postgres connection pool — definition reads + pgvector queries.
     Mitigation: pgBouncer / Aurora Data API; raise pool size.
  2. Run-trace write throughput (DDB/Postgres). DDB is on-demand;
     Postgres benefits from batched inserts in the executor.
  3. Node event-loop saturation per Lambda. Mitigation: split executor
     into one Lambda per node (Step Functions migration — next week).
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
