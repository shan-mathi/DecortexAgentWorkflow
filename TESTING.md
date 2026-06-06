# TESTING.md

The brief's question is *test judgment*, not coverage. The structuring claim of this codebase is: **software correctness and agent quality require different test strategies, and we treat them differently.** Software correctness is deterministic, gating, and runs on every commit; agent quality is judged, non-gating, and runs nightly with a real-LLM canary.

## Test pyramid for this system

| Layer | Where | Provider | Runs | Asserts |
| --- | --- | --- | --- | --- |
| Unit (engine internals) | `packages/engine/src/*.test.ts` | FakeLLM (often none) | every commit | topoLevels property test, validateDag aggregation, retry semantics, sandbox allow/deny, template substitution + missing-ref errors |
| Plugin contract (parameterised) | `packages/engine/src/testing/pluginContract.ts` | FakeLLM | every commit | every `NodeExecutor` accepts valid configs, rejects invalid, returns well-formed `NodeResult`, surfaces thrown errors as `status: FAILED` |
| Schema round-trips | `packages/shared/src/schemas.test.ts` | n/a | every commit | Zod schemas accept fixtures, reject malformed input |
| FakeLLM behaviour | `packages/fake-llm/src/fakeLlm.test.ts` | n/a | every commit | sha1 determinism, sha256 vector + L2 norm, latency distribution sampling, failure injection at rate=0 / rate=1 |
| Engine orchestration | `packages/engine/src/runWorkflow.test.ts` | FakeLLM | every commit | linear, diamond context merge, branch skipping, terminal-on-failure, parallel-level timing, idempotent append |
| API routes | `packages/api/test/api.test.ts` | FakeLLM | every commit | 400 Zod, 400 DAG, 413 oversized input, 202 trigger, full trace fetch, `/node-types` lists all five |
| Storage integration | `packages/storage/test/{workflowRepo,runRepo}.test.ts` | n/a | every commit (Docker) | round-trips, version bump, idempotent `appendNodeExecution`, `listRuns` ordering |
| Retrieval pipeline | `packages/storage/test/retrievalPipeline.test.ts` | FakeLLM | every commit (Docker) | self-similarity property: querying with the exact text of a seeded row returns that row first |
| End-to-end | `packages/storage/test/runWorkflow.e2e.test.ts` | FakeLLM | every commit (Docker) | ops-ticket-router runs through Postgres + pgvector, trace persisted, token usage attributed only to LLM + kb-retrieval nodes |
| Eval (15 hand-crafted tickets) | `pnpm eval` | FakeLLM by default; real LLM under `EVAL_REAL_LLM=1` | nightly + on demand | structural correctness only — `urgency ∈ {LOW,MED,HIGH}`, branch resolved, draft non-empty. Never asserts on exact LLM wording. |
| Load | `pnpm load` | **FakeLLM only — refuses real provider** | on demand | throughput, P50/P99 per node; produces an "expected bottleneck order" report |

Tests without Docker (the unit + API integration layer, ~95 tests) run in <2 seconds with no network. Tests with Docker (storage + e2e + retrieval, ~9 tests) gracefully skip when Docker is absent so the unit suite still passes everywhere.

## C1 — Data corpus

**Implemented:** 20 hand-crafted past tickets in `fixtures/tickets/seed.json` covering urgent outages, billing disputes, GDPR deadlines, multilingual snippets, half-sentence rage-typing, malformed JSON in body, ambiguous wording, low-priority feature requests. The eval set in `fixtures/eval/tickets.json` is 15 cases derived to stress the same edge cases against the workflow.

**Synthetic-data stance:** for the take-home, hand-crafted is honest; LLM-generated synthetic tickets risk dressing up the happy path. If we wanted to scale to thousands of cases, we would generate variants of each hand-crafted seed (different urgencies, languages, lengths) and label them with explicit dimensions, then use a small holdout of human-labelled cases to detect generation collapse. We did not implement this.

## C2 — Integrations

**LLM:** FakeLLM is the production-grade test path — same `LLMProvider` interface as a real provider, sha1-keyed canned responses, sha256-seeded deterministic vectors, configurable latency distribution, forceable failure modes. We use it in unit, integration, eval (default), load, and dev mode. Real providers are wired behind `LLM_PROVIDER=openai|anthropic` (one-file adapter; not committed today). The eval suite's `EVAL_REAL_LLM=1` is the canary path — same runner, real provider for one or two cases nightly.

**HTTP nodes:** unit tests stub `fetch` via `vi.stubGlobal`. We deliberately do not record/replay third-party APIs in the test suite for this take-home — it would be the next thing to add for production.

**What runs when:**
- Every commit: unit + plugin contract + API integration + (with Docker) storage integration + retrieval pipeline + e2e. ~104 tests total.
- Nightly (proposed): the eval suite under `EVAL_REAL_LLM=1` against one canary case per category, and the load test at a higher concurrency. Today this is "on demand" because we don't have a real key wired.
- Pre-release: full eval against the real provider on every case + a manual smoke against a deployed environment.

**Software correctness vs agent quality** — this is the load-bearing distinction. Software correctness lives in the deterministic layers above. Agent quality is graded by humans on real-LLM eval samples; the eval runner asserts only on *structural* correctness so it can run on every commit without brittleness against LLM wording.

## C3 — Load

**Implemented:** `scripts/load.ts` spawns N concurrent runs of the ops-ticket-router workflow against the in-process engine + FakeLLM (50 ms exponential latency, 1 % rate-limit injection). It reports throughput and per-node P50/P99. It refuses to run if `LLM_PROVIDER` is anything other than `fake` — non-negotiable per the design.

**Smoke result:** 50 runs, concurrency 10, ~85 runs/s on a laptop. Per-node P50 dominated by the LLM nodes (constant for FakeLLM at this latency); branch and retrieval are sub-millisecond.

**SLOs we'd set:** P99 run latency < 5s for the 5-node workflow under 100 concurrent runs; throughput > 50 runs/s with the in-process executor. The load script tells us when those break.

**Bottleneck order at higher load** (documented in the load script's report):
1. Postgres connection pool (definition reads + pgvector queries) — pgBouncer / Aurora Data API.
2. Run-trace write throughput — DDB on-demand mitigates; Postgres benefits from batched inserts.
3. Node event-loop saturation per Lambda — fix is splitting the executor into one Lambda per node (the Step Functions migration described under "next week").

## One bug the suite catches today

**Diamond-DAG context merge.** A node with two upstream parents must see *both* parents' outputs in `ctx.upstream` — a naive level-local map would only show the most recent level's outputs. We assert this in two places: `packages/engine/src/runWorkflow.test.ts` "merges both upstream outputs into a join node's ctx (diamond)" against in-memory repos, and `packages/storage/test/runWorkflow.e2e.test.ts` against real Postgres. Either test would fail if `parentOutputs` regressed to using only the immediately-prior level's outputs. The bug is real because the executor processes levels but joins reach back across levels.

## One bug the suite misses today

**The LLM produces a well-typed but factually wrong reply.** The eval suite asserts `urgency ∈ {LOW, MED, HIGH}` and that `draftReply.text` is non-empty — but if the classifier labels an urgent outage `LOW` and the workflow drafts a polite "we'll get back to you in 2 business days" response, every assertion still passes. Catching this requires human-evaluated samples (a labelled holdout where we score the LLM's *judgment*, not its *type-correctness*) or production telemetry (escalation rates from auto-drafted replies). We call it out honestly here rather than pretending coverage we don't have.
