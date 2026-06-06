# Implementation Plan

## Overview

This plan converts the design into discrete, incremental coding tasks ordered by leverage: the engine, plugin contract, and tests ship first; UI polish and AWS deploy ship last (and are optional). Tests are paired tightly with the code they cover — there is no separate "testing phase". TypeScript throughout, per the design (Node 20, Fastify, Drizzle, React + Vite). Tasks marked with `*` are optional sub-tasks.

## Tasks

- [x] 1. Bootstrap monorepo and shared types in `packages/shared`
  - [x] 1.1 Initialise pnpm workspace, root `tsconfig.base.json`, Vitest config, ESLint/Prettier
    - Create `pnpm-workspace.yaml` covering `packages/*`
    - Create `packages/shared` with `package.json`, `tsconfig.json`, `src/index.ts`
    - Wire `vitest` at the workspace root with a `test` script that runs across all packages
    - _Requirements: 9.2, 9.4_

  - [x] 1.2 Define Zod schemas for `WorkflowDef`, `NodeDef`, `EdgeDef` in `packages/shared`
    - Export both Zod schemas and inferred TypeScript types
    - Include `position_x`/`position_y` on `NodeDef` for editor persistence
    - Include optional `condition_expression` on `EdgeDef`
    - _Requirements: 1.1, 1.2, 7.5_

  - [x] 1.3 Define `NodeContext`, `NodeResult`, `RunStatus`, `NodeExecution`, `RunTrace`, `RunSummary`, `TokenUsage` types
    - Match the shapes called out in the design (status enum, durationMs, tokenUsage, error fields)
    - Export as both Zod schemas (for API validation) and TypeScript types
    - _Requirements: 4.1, 4.2, 4.3, 7.5_

  - [x]* 1.4 Write unit tests for shared schemas
    - Round-trip parse/serialise on representative fixtures
    - Reject malformed payloads with clear field paths
    - _Requirements: 1.1, 7.4_

- [x] 2. Implement `packages/fake-llm` as a first-class deployable LLMProvider
  - [x] 2.1 Define `LLMProvider` interface in `packages/shared`
    - Two methods: `complete({ prompt, model, maxTokens? })` and `embed({ text, model? })`
    - Return shapes include `tokenUsage` on both
    - _Requirements: 5.1_

  - [x] 2.2 Implement `FakeLLM.complete` with deterministic canned-response lookup
    - sha1(prompt) keyed map; fall back to a `defaultFor(prompt)` shape
    - Estimate `tokenUsage` from prompt and response length
    - _Requirements: 5.3, 5.7_

  - [x] 2.3 Implement `FakeLLM.embed` with deterministic, L2-normalised vectors
    - sha256(text) seed → seedrandom RNG → `embeddingDim` (default 1536) floats in [-1, 1]
    - L2-normalise before returning
    - _Requirements: 5.4, 6.4_

  - [x] 2.4 Implement configurable latency and failure-mode injection
    - Latency kinds: `constant`, `uniform`, `exponential` with mean
    - Failure kinds: `timeout`, `rate-limit`, `malformed-json`, `partial` with rate
    - _Requirements: 5.5, 5.6_

  - [x] 2.5 Write unit tests covering determinism, latency sampling, and failure injection
    - Same prompt twice → byte-identical text
    - Same text twice → byte-identical vector (assert L2 norm ≈ 1)
    - With `failure.rate=1` the configured error is always thrown; with `0` never thrown
    - Latency distributions sleep within expected bounds (using fake timers)
    - _Requirements: 5.3, 5.4, 5.5, 5.6_

- [x] 3. Implement engine core algorithms and interfaces in `packages/engine`
  - [x] 3.1 Define `NodeExecutor` interface and `NodeRegistry` class
    - `NodeExecutor`: `type`, `configSchema`, `execute(config, ctx)` — exactly three members
    - `NodeRegistry`: `register`, `get` (throws on unknown), `list` (returns `{ type, configSchema }`)
    - _Requirements: 2.1, 2.2_

  - [x] 3.2 Implement `validateDag(def)` returning a `Result` listing every violation
    - Detect cycles, dangling edges, unknown node types (registry-aware)
    - Pure function, no mutation of `def`
    - Aggregate all errors rather than failing on the first
    - _Requirements: 1.2, 1.3_

  - [x] 3.3 Implement `topoLevels(def)` via Kahn's algorithm grouped by depth
    - Return `NodeDef[][]` so each inner level can be run via `Promise.all`
    - Throw `"cycle detected"` when leftover indegree exists
    - _Requirements: 3.1_

  - [x] 3.4 Implement `resolveTemplate(template, ctx)` for `{{nodeId.path}}` and `{{input.path}}`
    - JSON.stringify non-string values; raw string for strings
    - Throw `TemplateError(nodeId, path)` on missing references
    - _Requirements: 12.4_

  - [x] 3.5 Implement `runNodeWithRetry(node, ctx, deps)` with exponential backoff and jitter
    - Default policy: `maxAttempts=3`, `backoffMs=200`, `jitter=0.3`
    - Per-node override via `node.config.retry`
    - Always returns `NodeResult`; never throws; sets `durationMs` from start of `execute` to settle
    - Increments `ctx.metadata.attempt` per attempt
    - _Requirements: 3.2, 12.4_

  - [x] 3.6 Implement `expr-eval` sandbox wrapper used by Branch and Transform
    - Bind `nodes.<id>.<field>` and `input.<field>`
    - Whitelist operators and string functions per design
    - Reject any usage that would reach `eval`/`vm`/`new Function`
    - _Requirements: 12.2_

  - [x] 3.7 Write unit tests for all engine core functions
    - `topoLevels`: random-DAG generator with property `level(u) < level(v)` for every edge `(u, v)`; cycle inputs throw
    - `validateDag`: dangling edge, cycle, unknown type — each case asserts the violation list
    - `resolveTemplate`: substitution, JSON-stringify of objects, missing-reference error
    - `runNodeWithRetry`: success on first attempt, success on third attempt, exhaustion, non-retryable short-circuit, `durationMs` measured correctly (fake timers)
    - Sandbox: disallowed tokens rejected; allowed expressions evaluate
    - _Requirements: 3.1, 3.2, 1.2, 12.2, 12.4, 10.1_

- [x] 4. Implement `runWorkflow` orchestrator and repository interfaces in `packages/engine`
  - [x] 4.1 Define `WorkflowRepo` and `RunRepo` interfaces in `packages/engine`
    - Match design exactly (`create`, `list`, `get`, `update` for workflows; `createRun`, `setRunStatus`, `appendNodeExecution`, `getRun`, `listRuns` for runs)
    - Engine package exports interfaces only — no concrete implementations here
    - _Requirements: 1.4, 1.5, 1.6, 4.3, 4.4, 4.5, 4.6_

  - [x] 4.2 Implement `runWorkflow(def, runInput, runId, deps)` per the design pseudocode
    - Validate DAG, compute topo levels, set status `RUNNING`
    - Iterate levels; each level runs via `Promise.all`
    - On Branch result: walk non-taken subtrees and add to `skipped` set; persist `SKIPPED` records
    - On terminal failure: persist all completed and failed executions, set status `FAILED`, return
    - Status sequence: `PENDING → RUNNING → (SUCCEEDED | FAILED)`; persist `endedAt` on terminal
    - _Requirements: 3.1, 3.3, 3.4, 3.5, 3.7_

  - [x] 4.3 Implement in-memory `WorkflowRepo` and `RunRepo` for unit testing
    - Lives under `packages/engine/src/testing/`
    - `appendNodeExecution` enforces idempotence on `(runId, nodeId)`
    - _Requirements: 4.5, 9.4_

  - [x] 4.4 Write unit tests for `runWorkflow` against in-memory repos
    - Linear DAG runs all nodes in order
    - Diamond DAG: a node with two parents receives both upstream outputs in `ctx.upstream`
    - Branch: non-taken subtree marked `SKIPPED`; taken path executes normally
    - Terminal-on-failure: subsequent levels not scheduled; trace persisted up to the failure
    - Parallel level: two nodes at the same depth observed running concurrently (FakeLLM with `latency=constant`)
    - Status transitions persisted in the right order with `endedAt` set on terminal
    - `appendNodeExecution` called once per node (idempotent)
    - _Requirements: 3.1, 3.3, 3.4, 3.5, 4.1, 4.5, 10.1, 10.2_

- [x] 5. Implement built-in node types and the parameterised plugin-contract test suite in `packages/engine`
  - [x] 5.1 Implement `LLMNode` (`type: "llm"`)
    - Resolve `promptTemplate` against `ctx`; call `LLMProvider.complete`
    - Return `{ text, tokenUsage }`; attribute tokens to this node
    - _Requirements: 2.3, 12.5_

  - [x] 5.2 Implement `HTTPNode` (`type: "http"`)
    - Template `url` and `bodyTemplate`; native `fetch`
    - Non-2xx → throw retryable error so `runNodeWithRetry` handles policy
    - Return `{ status, body }`
    - _Requirements: 2.3_

  - [x] 5.3 Implement `BranchNode` (`type: "branch"`)
    - Evaluate sandboxed `expression` against `ctx.upstream`
    - Match against `branches` map; set `output.takenBranch = nextNodeId`
    - _Requirements: 2.3, 3.3, 12.2_

  - [x] 5.4 Implement `TransformNode` (`type: "transform"`)
    - Evaluate sandboxed `expression` and return its value as `output`
    - _Requirements: 2.3, 12.2_

  - [x] 5.5 Write the generic `pluginContract` test suite parameterised over `NodeExecutor`
    - Asserts: `configSchema` rejects clearly invalid configs; `execute` returns a well-formed `NodeResult` for at least one happy-path config; thrown errors surface as `status: "FAILED"` (via `runNodeWithRetry` wrapper) rather than unhandled rejection
    - Exposed as a reusable function in `packages/engine/src/testing/pluginContract.ts`
    - _Requirements: 2.5, 2.6, 10.3_

  - [x] 5.6 Run the plugin-contract suite against `LLMNode`, `HTTPNode`, `BranchNode`, `TransformNode`
    - Each built-in has its own test file that imports the parameterised suite
    - All four pass before moving on
    - _Requirements: 2.6, 10.3_

  - [x] 5.7 Implement `registerNodes(registry, deps)` in `packages/engine/src/registerNodes.ts`
    - Single registration entry point; both Lambdas import it
    - Compile-time only; no runtime loading
    - _Requirements: 2.4, 2.7_

- [x] 6. Checkpoint - Ensure all engine unit tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement Postgres storage in `packages/storage`
  - [x] 7.1 Define Drizzle schema for `workflows`, `nodes`, `edges`, `tickets_seed`
    - Match design ERD; `tickets_seed.embedding` typed as `vector(1536)` via pgvector
    - Migration file creates `pgvector` extension and IVFFlat index on `embedding`
    - Unique constraint on `(run_id, node_id)` for the run-execution table
    - _Requirements: 4.5, 9.1_

  - [x] 7.2 Implement `WorkflowRepoPostgres` against the engine interface
    - `create` writes workflow + nodes + edges in a single transaction
    - `update` increments `version` and preserves prior rows (insert new version)
    - `get` builds the full `WorkflowDef` in one round-trip (joined query)
    - _Requirements: 1.4, 1.5, 1.6_

  - [x] 7.3 Implement `RunRepoPostgres` against the engine interface
    - Tables: `runs` (META) and `node_executions` (with unique `(run_id, node_id)`)
    - `appendNodeExecution` is idempotent via the unique constraint
    - `getRun` returns META + all node executions in one query
    - `listRuns(workflowId)` indexed lookup ordered by `started_at`
    - _Requirements: 4.3, 4.4, 4.5, 4.6_

  - [x] 7.4 Write Testcontainers integration tests for both repos
    - Spin up Postgres with pgvector extension installed
    - Round-trip a `WorkflowDef` (create → get → update → get) asserting version increments
    - Round-trip a run trace (createRun → appendNodeExecution × N → getRun)
    - Idempotence: second `appendNodeExecution` with same `(runId, nodeId)` does not throw and does not duplicate
    - `listRuns` ordering correctness
    - _Requirements: 1.4, 1.5, 1.6, 4.3, 4.4, 4.5, 4.6, 10.2_

- [x] 8. Implement `kb-retrieval` plugin and seed script
  - [x] 8.1 Implement `KnowledgeBaseRetrievalNode` in `packages/engine/src/plugins/kbRetrieval.ts`
    - `configSchema`: `{ knowledgeBase: "tickets", queryTemplate, topK }`
    - Resolve query; call `LLMProvider.embed`; pgvector cosine-distance query against `tickets_seed`
    - Return `{ documents, query }` plus embedding `tokenUsage`
    - Register in `registerNodes` alongside the built-ins
    - _Requirements: 2.3, 2.4, 6.4, 6.5, 12.5_

  - [x] 8.2 Run the plugin-contract suite against `KnowledgeBaseRetrievalNode`
    - Reuse the parameterised suite from task 5.5
    - _Requirements: 2.6, 10.3_

  - [x] 8.3 Implement `scripts/seed-tickets.ts` to load the corpus
    - Loads ~20 hand-crafted past tickets from a fixture JSON
    - Computes embedding for each via `LLMProvider.embed`
    - Idempotent: truncate-and-reload by default
    - _Requirements: 6.6_

  - [x] 8.4 Write the deterministic retrieval-pipeline test
    - Testcontainers Postgres seeded with the fixed corpus and FakeLLM embeddings
    - Run `KnowledgeBaseRetrievalNode` with a known query; assert returned document IDs match the expected list in expected order
    - No real LLM, no flakiness — gated on every commit
    - _Requirements: 6.4, 10.4_

- [x] 9. Write the end-to-end integration test for full DAG execution
  - [x] 9.1 Set up an integration harness using Testcontainers Postgres + FakeLLM
    - Lives under `packages/engine/test/integration/`
    - Loads the `ops-ticket-router` workflow from a fixture (not hardcoded in source)
    - _Requirements: 6.2, 9.4, 10.2_

  - [x] 9.2 Run the full ops-ticket-router workflow end-to-end and assert trace persistence
    - All five nodes produce records (or `SKIPPED` for non-taken Branch path)
    - META transitions `PENDING → RUNNING → SUCCEEDED` with `endedAt` set
    - Token usage attributed to `llm` and `kb-retrieval` nodes only
    - _Requirements: 3.5, 4.1, 4.2, 4.3, 12.5_

  - [x] 9.3 Assert parallel execution timing for a diamond DAG
    - Use a synthetic fixture with two siblings at the same level, FakeLLM `latency=constant 200ms`
    - Wall time for the level ≈ 200ms (not 400ms) — tolerance ±50ms
    - _Requirements: 3.1, 10.2_

  - [x] 9.4 Assert diamond-DAG context merge (the bug the suite catches today)
    - Workflow: A → C, B → C where C is a Transform reading both `nodes.A` and `nodes.B`
    - C's result must reflect both upstream outputs
    - _Requirements: 3.1, 10.2_

  - [x] 9.5 Assert idempotent `appendNodeExecution` end-to-end
    - Trigger a duplicate write path and confirm no duplicate row, no thrown error
    - _Requirements: 4.5_

- [x] 10. Implement `packages/api` Fastify routes
  - [x] 10.1 Bootstrap Fastify app with shared route registration
    - `packages/api/src/app.ts` exports `buildApp(deps)` returning a Fastify instance
    - Local entry: `src/local.ts` calls `app.listen()`
    - AWS entry: `src/lambda.ts` wraps via `@fastify/aws-lambda`
    - _Requirements: 9.2, 11.3_

  - [x] 10.2 Implement workflow CRUD routes
    - `POST /workflows` — Zod-validate body; run `validateDag`; persist in one transaction; 400 on violations with field-error list
    - `GET /workflows` — list summaries
    - `GET /workflows/:id` — full def in one round-trip
    - `PUT /workflows/:id` — version bump preserving prior rows
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 7.1, 7.4_

  - [x] 10.3 Implement run trigger and trace routes
    - `POST /workflows/:id/runs` — validate `{ input }`, reject > 256 KB with HTTP 413, persist `PENDING` META, async-invoke executor, return 202
    - In local mode, async-invoke is `setImmediate(() => runWorkflow(...))` against the in-process engine
    - In AWS mode, the same call invokes the executor Lambda via `@aws-sdk/client-lambda` with `InvocationType=Event`
    - `GET /runs/:id` — META + node executions in one round-trip
    - `GET /workflows/:id/runs` — run summaries ordered by `startedAt`
    - _Requirements: 3.6, 3.7, 4.4, 4.6, 7.1, 7.2, 7.6, 12.6_

  - [x] 10.4 Implement `GET /node-types` from the same `NodeRegistry` the executor consumes
    - Return `{ type, displayName, description, category, configSchema }[]`
    - Convert each Zod `configSchema` to JSON Schema via `zod-to-json-schema`
    - _Requirements: 2.4, 7.3, 8.2_

  - [x] 10.5 Write Supertest integration tests for every route
    - Valid + invalid POST/PUT bodies; 400 with field errors
    - Run trigger returns 202 + `{ runId, status: "PENDING" }`
    - Oversized `runInput` returns 413
    - `GET /runs/:id` after a completed in-process run returns the full trace
    - `GET /node-types` includes all built-ins plus `kb-retrieval`
    - All tests run against an in-memory engine + FakeLLM (Testcontainers Postgres for routes that touch storage)
    - _Requirements: 1.1, 7.1, 7.2, 7.3, 7.4, 7.6, 10.2_

- [x] 11. Define the ops-ticket-router workflow and the eval suite
  - [x] 11.1 Add the ops-ticket-router workflow as a JSON fixture
    - File: `fixtures/workflows/ops-ticket-router.json`
    - Five nodes (`classify`, `branch`, `fetchSimilar`, `draftReply`, `draftLow`) and edges per design
    - Loaded by the API at dev startup via a one-off `pnpm seed:workflows` script — not imported into engine source
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 11.2 Curate 10–20 hand-crafted ops tickets covering edge cases
    - File: `fixtures/eval/tickets.json`
    - Include: urgent outage, low-priority password reset, ambiguous wording, multilingual snippets, half-sentence rage-typing, malformed JSON in body
    - Each case has an `expected` block describing structural assertions only
    - _Requirements: 10.5_

  - [x] 11.3 Implement `pnpm eval` runner that runs each ticket through the workflow
    - Default: FakeLLM provider (deterministic, free, gating)
    - Asserts on structural correctness only: `urgency ∈ {LOW, MED, HIGH}`, `fetchSimilar.documents.length === 3` (when branch taken), `draftReply.text` non-empty
    - Never asserts on exact LLM wording
    - _Requirements: 10.5, 10.8_

  - [x] 11.4 Implement the real-LLM canary path behind `EVAL_REAL_LLM=1`
    - Same eval runner; flips `LLM_PROVIDER` to the real provider for one canary case
    - Required: the code path is implemented and unit-tested with a stubbed real-provider double
    - _Requirements: 10.6, 10.8_

  - [ ]* 11.5 Wire `EVAL_REAL_LLM=1` to actually call OpenAI/Anthropic with a real key
    - Optional — depends on whether a paid key is available before submission
    - _Requirements: 10.6_

- [x] 12. Implement `scripts/load.ts` load-test script
  - [x] 12.1 Script accepts `--concurrency N` and `--total M`
    - FakeLLM with realistic latency distribution and 1% failure injection
    - Spawns N concurrent runs against the in-process engine
    - _Requirements: 10.7_

  - [x] 12.2 Measure and report throughput and per-node P50/P99 duration
    - Output a one-page summary at the end (table + a short comment block listing expected bottlenecks: Postgres pool → DDB throttling → event-loop saturation)
    - Hard-coded `LLM_PROVIDER=fake`; refuses to run if a real provider is configured
    - _Requirements: 10.7, 10.8_

- [x] 13. Checkpoint - Ensure all backend tests, integration tests, eval, and load script pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Implement `packages/web` read-only views
  - [x] 14.1 Bootstrap React + Vite + Tailwind app
    - Wire `@xyflow/react` and a typed API client built from `packages/shared` schemas
    - Fetch `GET /node-types` once on app load; cache for the session
    - _Requirements: 8.2, 9.2_

  - [x] 14.2 Implement workflows list page
    - Table from `GET /workflows`; click navigates to detail
    - _Requirements: 8.1_

  - [x] 14.3 Implement workflow detail page (read-only React Flow + JSON tab)
    - Nodes laid out from `position_x/y`; node labels/icons from `/node-types` response
    - "Trigger run" button opens a JSON input modal, POSTs `/workflows/:id/runs`, navigates to run page
    - _Requirements: 8.1, 8.2, 8.4_

  - [x] 14.4 Implement run trace page with status-coloured graph and per-node panel
    - Poll `GET /runs/:id` every 1s while non-terminal
    - Status colours: gray pending, blue running, green succeeded, red failed, dashed gray skipped
    - Click a node → side panel showing `input`, `output`, `durationMs`, `attemptCount`, `tokenUsage`, `error`
    - _Requirements: 8.5, 8.6_

  - [x] 14.5 Implement per-workflow runs list page
    - Table with status badges and durations
    - _Requirements: 8.1_

  - [ ]* 14.6 Add basic theming and polish
    - Optional — only after the editor (task 15) ships
    - _Requirements: 8.1_

- [x] 15. Implement `packages/web` selection-order workflow editor
  - [x] 15.1 Build palette + selection-order list driven by `/node-types`
    - When a new node type is registered and deployed, it appears in the palette without UI code change
    - _Requirements: 8.2, 8.3_

  - [x] 15.2 Auto-generate config forms via `@rjsf/core` from `configSchema`
    - One form per node, no hand-written form per type
    - _Requirements: 8.2, 8.3_

  - [x] 15.3 Implement the Branch routing form
    - For each `caseLabel` on the Branch config, pick a target from already-added downstream nodes
    - Synthesise `branch[case] → target` edges and drop the linear-next edge from the Branch
    - _Requirements: 8.3_

  - [x] 15.4 Add a JSON view toggle and POST to `/workflows`
    - Toggle renders the synthesised `WorkflowDef` exactly as the editor would post it
    - Save calls `POST /workflows` and navigates to the new workflow's detail page
    - _Requirements: 8.3_

- [x] 16. Wire `pnpm dev` orchestration
  - [x] 16.1 Add `pnpm dev` script using `concurrently` to run API, in-process executor, and Web
    - Default `LLM_PROVIDER=fake` when unset
    - Document `docker compose up` as the one prerequisite (Postgres + pgvector)
    - _Requirements: 9.1, 9.2, 9.3, 9.5_

  - [ ]* 16.2 Add a polished dev-mode logger
    - Optional — colourised per-package prefixes, request/response capture
    - _Requirements: 9.2_

- [ ]* 17. AWS deployment scaffolding (entire task is optional)
  - [ ]* 17.1 Add esbuild bundle scripts for both Lambda entry points
    - One bundle per Lambda; tree-shaken to ~1 MB per design
    - _Requirements: 11.1, 11.3_

  - [ ]* 17.2 Implement `RunRepoDynamo` against the engine interface
    - Single-table layout per design; idempotent `appendNodeExecution` via `attribute_not_exists(SK)` condition
    - GSI `byWorkflow` for run lists
    - Selected at runtime by `RUN_REPO=ddb`
    - _Requirements: 4.4, 4.5, 4.6, 11.3_

  - [ ]* 17.3 Implement `scripts/deploy.sh` calling `aws lambda update-function-code` for both Lambdas
    - No CDK / Terraform / SAM
    - _Requirements: 11.2, 11.4_

- [x] 18. Write documentation deliverables
  - [x] 18.1 Write `README.md`
    - How to run locally (`docker compose up`, `pnpm install`, `pnpm dev`)
    - What works end-to-end and what is unfinished
    - Every command: `pnpm test`, `pnpm test:integration`, `pnpm eval`, `pnpm load`, `pnpm dev`
    - Every "works end-to-end" claim maps to a passing test or runnable command
    - _Requirements: 13.1, 13.4_

  - [x] 18.2 Write `DESIGN.md` (≤ 2 pages)
    - Condensed from `design.md` using the existing template at the bottom of that file
    - Data model, execution ordering, plugin mechanism, three design decisions with rejections, three things to build next
    - _Requirements: 13.2, 13.4_

  - [x] 18.3 Write `TESTING.md` (≤ 1 page)
    - Answers C1 (data corpus), C2 (integration strategy + which tests run when and why), C3 (load + SLOs)
    - The test pyramid for this system
    - One bug the suite catches today (diamond-DAG context merge)
    - One bug it misses today (LLM produces well-typed but factually wrong output)
    - _Requirements: 13.3, 13.4_

- [x] 19. Final checkpoint - Ensure all required tests pass and docs match the system as built
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional sub-tasks and can be skipped without breaking the deliverable. The AWS deployment task (17) is wholly optional — local dev is the primary deliverable.
- Tests are paired with the code they cover. There is no terminal "testing phase".
- Every task references specific requirements for traceability.
- The plugin-contract test suite (5.5) and the deterministic retrieval-pipeline test (8.4) are the two artefacts that prove the platform claims. They are required.
- The diamond-DAG context-merge integration test (9.4) is the bug the suite catches today, called out explicitly in design.md's testing strategy.
- The load test (12) uses FakeLLM only and refuses to run against a real provider — non-negotiable.
