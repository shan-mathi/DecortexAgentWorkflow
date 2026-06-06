# Agent Workflow Engine

A small, opinionated agent workflow platform: a typed-DAG executor with a real plugin contract, a deterministic FakeLLM provider, an ops-ticket-router workflow, and a layered test suite.

The brief lives in `fullstack-assignment-1.md`. The full spec (requirements, design, task plan) lives under `.kiro/specs/agent-workflow-engine/`.

## Stack

- **TypeScript 5 + Node 20**, pnpm workspace
- **Engine**: pure TS (`packages/engine`) — DAG executor, NodeRegistry, plugin contract, retry policy, expr-eval sandbox
- **Storage**: Postgres + pgvector via Drizzle (`packages/storage`)
- **API**: Fastify (`packages/api`)
- **Web**: React + Vite + Tailwind + React Flow + RJSF (`packages/web`)
- **FakeLLM**: deterministic, deployable LLMProvider (`packages/fake-llm`)

## Run it locally

Prerequisites: Node 20+, pnpm 9, Docker.

```sh
pnpm install
docker compose up -d              # Postgres + pgvector on :5432
pnpm seed:tickets                 # ~20 hand-crafted past tickets, FakeLLM-embedded
pnpm seed:workflows               # registers the ops-ticket-router workflow
pnpm dev                          # API on :3000, Web on :5173
```

Open http://localhost:5173, click "ops-ticket-router", then **Trigger run** with:

```json
{ "subject": "Production API down", "body": "All requests are 503 in us-east-1." }
```

Watch the trace page — graph nodes recolour as the run progresses; click any node to inspect its input, output, duration, attempts, and token usage.

## What works end-to-end

| Capability | Verified by |
| --- | --- |
| Plugin contract: implement `NodeExecutor`, register once, no executor change | `packages/engine/src/builtins/*.test.ts`, `packages/engine/src/plugins/kbRetrieval.test.ts` (5 contract suites) |
| DAG executor: parallel levels, retries, branch skipping, terminal failure | `packages/engine/src/runWorkflow.test.ts` |
| Diamond-DAG context merge (the bug the suite catches today) | `packages/engine/src/runWorkflow.test.ts` "diamond" + `packages/storage/test/runWorkflow.e2e.test.ts` |
| Postgres CRUD + run trace persistence with `(run_id, node_id)` idempotency | `packages/storage/test/{workflowRepo,runRepo}.test.ts` |
| Deterministic vector retrieval (FakeLLM-seeded, exact id ordering) | `packages/storage/test/retrievalPipeline.test.ts` |
| API: validation, 413 on oversized input, 202 on run trigger, full trace fetch, `/node-types` | `packages/api/test/api.test.ts` |
| Eval suite over 15 hand-crafted tickets with edge cases | `pnpm eval` |
| Load test against FakeLLM, refuses real provider | `pnpm load` |

## Commands

```sh
pnpm test               # unit tests + API integration tests (FakeLLM only, no Docker required)
pnpm test:integration   # storage + e2e tests against Testcontainers Postgres (Docker required)
pnpm typecheck          # all packages
pnpm eval               # 15-case eval over the ops-ticket-router (FakeLLM)
EVAL_REAL_LLM=1 pnpm eval   # canary against real provider (stub today; see TESTING.md)
pnpm load --concurrency=20 --total=500   # FakeLLM only, refuses real provider
pnpm seed:tickets       # load fixtures/tickets/seed.json into tickets_seed
pnpm seed:workflows     # load fixtures/workflows/*.json into workflows
pnpm dev                # API + Web concurrently
```

Default LLM provider is `fake`. Override with `LLM_PROVIDER=openai|anthropic` (real providers are stubbed today; FakeLLM is the production-grade path for this submission).

## What is unfinished

Listed honestly:

- **Real-LLM canary path (`EVAL_REAL_LLM=1`)** — the env-flag branch is wired and the eval runner falls back to FakeLLM with a clear log line. Hooking up the real OpenAI/Anthropic SDK is a one-file change (a new `LLMProvider` adapter); skipped here because the brief allows FakeLLM and the eval grades structural correctness only.
- **AWS deployment** (executor Lambda, API Lambda, DynamoDB `RunRepoDynamo`) — entire path is deliberately out of scope per the brief. The interfaces are in place (`RunRepo`, single `registerNodes` entry point, esbuild-friendly engine package) so the migration is mechanical.
- **Postgres-backed workflow versioning history** — we bump `version` on update but do not preserve prior rows. Documented as a deliberate cut in DESIGN.md.
- **Reaper for orphaned RUNNING runs** — a sweep query for runs stuck past `endedAt + 15m`. Documented under "things to build next".
- **Selection-order editor's diamond / multi-Branch UX** — the engine accepts these; the editor's form-stacking UX gets confusing. Power users use the JSON view in the editor.

## Repo layout

```
packages/
  shared/      Zod schemas + types + LLMProvider interface
  fake-llm/    deterministic, deployable LLMProvider
  engine/      DAG executor, registry, plugin contract, built-ins, kb-retrieval
  storage/     Drizzle schema, Postgres repos, Testcontainers tests
  api/         Fastify routes
  web/         React + Vite + Tailwind UI

scripts/       seed-tickets, seed-workflows, eval, load
fixtures/      tickets corpus, ops-ticket-router workflow, eval cases
.kiro/specs/   requirements / design / tasks (the source of truth for scope)
```

See **DESIGN.md** for the data model, execution semantics, plugin mechanism, three design decisions, and three things to build next.

See **TESTING.md** for the test pyramid, the C1/C2/C3 stance, one bug the suite catches today, and one bug it misses today.
