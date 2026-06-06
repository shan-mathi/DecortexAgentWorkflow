# Requirements Document

## Introduction

This document captures the requirements for the **agent-workflow-engine** take-home build: a minimal but extensible engine that executes DAGs of typed nodes (LLM, HTTP, Branch, Transform, plus pluggable types), persists per-node traces, and ships one vertical use-case (ops-ticket router) implemented purely as a workflow definition. Requirements are derived from the approved design document at `.kiro/specs/agent-workflow-engine/design.md` and traced back to the assignment brief in `fullstack-assignment-1.md`. Architecture, data shapes, and rejected alternatives live in the design doc; this document only states *what the system must do* in testable terms.

## Glossary

- **Engine**: The pure TypeScript executor package (`packages/engine`); knows nothing about HTTP, AWS, or specific databases. (Design: *Architecture / Monorepo layout*.)
- **API**: The Fastify HTTP layer; deployed as a Lambda in AWS, runs as a local server in dev. (Design: *API Surface*.)
- **Executor**: The component that runs a single workflow run; in AWS it is one Lambda per run, locally it is an in-process async function. (Design: *Architecture / Run trigger sequence*.)
- **NodeExecutor**: The TypeScript interface a node-type author implements (`type`, `configSchema`, `execute`). (Design: *NodeExecutor — the plugin contract*.)
- **NodeRegistry**: The compile-time registry that maps node `type` strings to `NodeExecutor` instances. (Design: *NodeRegistry*.)
- **WorkflowRepo / RunRepo**: Storage interfaces consumed by the engine; concrete implementations differ between local (Postgres) and AWS (Postgres + DynamoDB). (Design: *Repository interfaces*.)
- **LLMProvider**: Interface exposing `complete()` and `embed()`; selectable at process start via `LLM_PROVIDER` env var. (Design: *LLMProvider*.)
- **FakeLLM**: Deterministic, deployable `LLMProvider` implementation with configurable latency and failure modes. (Design: *FakeLLM (first-class)*.)
- **KB_Retrieval_Node**: The `kb-retrieval` plugin that performs pgvector cosine-distance search over `tickets_seed`. (Design: *Plugin built for the vertical: KnowledgeBaseRetrieval*.)
- **Web**: The React + Vite + Tailwind + React Flow UI. (Design: *UI Scope*.)
- **WorkflowDef**: The Zod-validated object containing `nodes`, `edges`, and metadata. (Design: *Components and Interfaces*.)
- **Reviewer**: The assignment grader who clones the repo and runs it locally.

---

## Requirements

### Requirement 1: Workflow Definition and Storage

**User Story:** As a Workflow Author, I want to define, persist, and version workflows as JSON DAGs, so that I can iterate on workflow logic without redeploying code.

*(Trace: brief Part A.1 "Workflow definition"; design *Data Models / Postgres*, *API Surface*.)*

#### Acceptance Criteria

1. WHEN a `WorkflowDef` is submitted to any CRUD endpoint, THE API SHALL validate the payload against a Zod schema and reject malformed input with HTTP 400 listing every field error.
2. WHEN a `WorkflowDef` is validated, THE API SHALL run a DAG check that confirms the graph is acyclic, every edge endpoint references a defined node, and every node `type` is present in the NodeRegistry.
3. IF DAG validation fails, THEN THE API SHALL return HTTP 400 with the full list of violations and SHALL NOT persist the workflow.
4. WHEN a valid workflow is created, THE API SHALL persist it to Postgres across the `workflows`, `nodes`, and `edges` tables in a single transaction.
5. WHEN `PUT /workflows/:id` is called with a valid `WorkflowDef`, THE API SHALL increment the workflow `version` field and SHALL preserve the previous version's row history.
6. WHEN `GET /workflows/:id` is called, THE API SHALL return the full definition (workflow row, all nodes, all edges) in one response built from one repository round-trip.

---

### Requirement 2: Node Plugin Model

**User Story:** As a Plugin Developer, I want to add a new node type by writing one file and registering it once, so that I can extend the platform without modifying executor core.

*(Trace: brief Part A.3 "Plugin model for nodes"; design *NodeExecutor — the plugin contract*, *Node deployment lifecycle*.)*

#### Acceptance Criteria

1. THE Engine SHALL expose a `NodeExecutor` interface requiring exactly three members: `type: string`, `configSchema: ZodType`, and `execute(config, ctx): Promise<NodeResult>`.
2. THE NodeRegistry SHALL provide `register(executor)`, `get(type)` (throws on unknown type), and `list()` operations.
3. WHEN the four built-in node types (`llm`, `http`, `branch`, `transform`) and the `kb-retrieval` plugin are registered, THE Engine SHALL dispatch each node through the same NodeRegistry lookup with no special-casing branches in executor core.
4. WHEN a Plugin Developer adds a new node type, THE Plugin Developer SHALL implement exactly one new file in `packages/engine/src/plugins/` and add exactly one `register()` call in `registerNodes.ts` to make it available to both the Executor and the API.
5. THE Engine SHALL provide a generic plugin-contract test suite parameterised over any `NodeExecutor` that asserts: `configSchema` rejects clearly invalid configs, `execute` returns a well-formed `NodeResult` for at least one happy-path config, and thrown errors are surfaced as `status: "FAILED"` rather than unhandled rejections.
6. THE built-in node types and the `kb-retrieval` plugin SHALL all pass the generic plugin-contract test suite.
7. THE Engine SHALL register node executors at compile time only and SHALL NOT load executor code from disk, network, or S3 at runtime.

---

### Requirement 3: Executor Behaviour

**User Story:** As an Operator, I want the executor to run my workflow correctly with parallelism, retries, and predictable failure semantics, so that I can trust run results without inspecting engine internals.

*(Trace: brief Part A.2 "Executor"; design *Algorithmic Pseudocode*, *Error Handling*.)*

#### Acceptance Criteria

1. WHEN a run is triggered, THE Executor SHALL compute topological levels using Kahn's algorithm and SHALL execute all nodes within a single level concurrently via `Promise.all`.
2. WHEN a node throws during `execute`, THE Executor SHALL retry per the node's retry policy with exponential backoff and jitter, defaulting to 3 attempts when no policy is configured, and SHALL allow per-node override of `maxAttempts`, `backoffMs`, and `jitter`.
3. WHEN a Branch node returns a `takenBranch`, THE Executor SHALL mark every node in the non-taken downstream subtrees as `SKIPPED` and SHALL persist a `SKIPPED` node-execution record for each.
4. IF a node configured as terminal-on-failure returns `status: "FAILED"`, THEN THE Executor SHALL stop scheduling further nodes, SHALL persist all completed and failed node executions, and SHALL transition run status to `FAILED`.
5. THE Executor SHALL transition run status through exactly the sequence `PENDING → RUNNING → (SUCCEEDED | FAILED)` and SHALL persist `endedAt` when reaching a terminal status.
6. WHEN deployed to AWS, THE API SHALL invoke the Executor Lambda asynchronously (`InvocationType=Event`) exactly once per run, and the Executor SHALL complete the entire run inside that single invocation.
7. WHEN running in local development, THE Engine SHALL expose the same `runWorkflow(def, input, runId, deps)` function used by the Executor Lambda, callable directly without any AWS SDK.

---

### Requirement 4: Run Trace Persistence

**User Story:** As an Operator, I want every run and every node execution durably recorded with full I/O, so that I can debug failures and audit behaviour after the fact.

*(Trace: brief Part A.2 "Persist every run and every node execution"; design *Data Models / DynamoDB*, *Algorithmic Pseudocode / appendNodeExecution*.)*

#### Acceptance Criteria

1. WHEN a node finishes execution, THE Executor SHALL persist a record containing `nodeId`, `input`, `output`, `status`, `durationMs`, `error` (when applicable), `attemptCount`, and `startedAt`.
2. WHERE the node type is `llm` or `kb-retrieval`, THE Executor SHALL include `tokenUsage` (`promptTokens`, `completionTokens`) on the persisted node-execution record.
3. WHEN a run is created, THE API SHALL persist a META record containing `runId`, `workflowId`, `status`, `startedAt`, `endedAt` (nullable until terminal), and the run `input`.
4. WHEN `GET /runs/:id` is called, THE API SHALL return the META record plus all node-execution records for the run from a single repository round-trip (one DDB `Query` on `PK=RUN#{runId}` in AWS, one SQL query locally).
5. WHEN `appendNodeExecution(runId, ne)` is called twice with the same `(runId, nodeId)` pair, THE RunRepo SHALL accept the first write and reject or no-op the second (DDB `attribute_not_exists(SK)` condition; Postgres unique constraint on `(run_id, node_id)`).
6. WHEN `GET /workflows/:id/runs` is called, THE API SHALL return run summaries for the workflow ordered by `startedAt`, served by the `byWorkflow` GSI in DynamoDB or an indexed query in Postgres.

---

### Requirement 5: LLM Provider Interface

**User Story:** As a Workflow Author, I want a single `LLMProvider` interface that all LLM-touching code uses, so that I can swap providers (real or fake) by changing one env var.

*(Trace: brief Constraints "LLM provider is your choice"; design *LLMProvider*, *FakeLLM (first-class)*.)*

#### Acceptance Criteria

1. THE LLMProvider interface SHALL expose exactly two methods: `complete({ prompt, model, maxTokens? })` returning `{ text, tokenUsage }` and `embed({ text, model? })` returning `{ vector: number[], tokenUsage }`.
2. WHEN the process starts, THE Engine SHALL select the active `LLMProvider` based on the `LLM_PROVIDER` environment variable with allowed values `fake`, `openai`, and `anthropic`.
3. WHEN FakeLLM `complete()` is called twice with the same prompt, THE FakeLLM SHALL return byte-identical text in both calls (sha1-keyed canned-response lookup).
4. WHEN FakeLLM `embed()` is called twice with the same input text, THE FakeLLM SHALL return a byte-identical vector in both calls (sha256-seeded RNG, L2-normalised).
5. THE FakeLLM SHALL accept a configurable latency distribution (`constant`, `uniform`, `exponential` with mean) and SHALL sleep accordingly before returning.
6. THE FakeLLM SHALL accept a configurable failure mode (`timeout`, `rate-limit`, `malformed-json`, `partial`) with a configurable rate, and SHALL throw the corresponding error at that rate.
7. THE FakeLLM SHALL be deployable as a real `LLMProvider` selected by `LLM_PROVIDER=fake` in any environment, including AWS Lambda.

---

### Requirement 6: Vertical Use-Case — Ops-Ticket Router

**User Story:** As a Workflow Author, I want the ops-ticket router to be expressible entirely as a workflow definition with no domain code outside the engine, so that the platform's primitives are proven against a real vertical.

*(Trace: brief Part B "Ops-ticket router"; design *Example Usage*, *Plugin built for the vertical*.)*

#### Acceptance Criteria

1. THE ops-ticket router SHALL be defined as a `WorkflowDef` containing exactly five nodes: `classify` (`llm`), `branch` (`branch`), `fetchSimilar` (`kb-retrieval`), `draftReply` (`llm`), and `draftLow` (`llm`).
2. THE Engine SHALL contain no source file whose only purpose is ops-ticket routing logic — the workflow's behaviour SHALL be expressed entirely via node configs, prompt templates, and edges.
3. WHEN the `classify` node returns urgency `HIGH` or `MED`, THE `branch` node SHALL route to `fetchSimilar`; WHEN it returns `LOW`, THE `branch` node SHALL route to `draftLow`.
4. WHEN the `kb-retrieval` node executes, THE KB_Retrieval_Node SHALL embed the query via `LLMProvider.embed`, query `tickets_seed` using pgvector cosine distance (`embedding <=> $1`), and return the top-K rows ordered by similarity.
5. THE LLMProvider SHALL NOT be passed any database connection, and no LLM node SHALL execute SQL — retrieval is owned exclusively by the `kb-retrieval` node.
6. WHEN `scripts/seed-tickets.ts` is run, THE seed loader SHALL populate `tickets_seed` with a fixed corpus and SHALL compute and store an embedding for each row via `LLMProvider.embed`.

---

### Requirement 7: API Surface

**User Story:** As an Operator (and as Web), I want a typed, validated REST API that covers workflow CRUD, run triggering, trace reading, and node-type discovery, so that all clients share one contract.

*(Trace: brief Part A.4 "API"; design *API Surface*.)*

#### Acceptance Criteria

1. THE API SHALL expose the following endpoints: `POST /workflows`, `GET /workflows`, `GET /workflows/:id`, `PUT /workflows/:id`, `POST /workflows/:id/runs`, `GET /runs/:id`, `GET /workflows/:id/runs`, and `GET /node-types`.
2. WHEN `POST /workflows/:id/runs` is called with a valid body `{ input }`, THE API SHALL persist a PENDING run record, asynchronously invoke the Executor with `(runId, workflowId, input)`, and return HTTP 202 with body `{ runId, status: "PENDING" }`.
3. WHEN `GET /node-types` is called, THE API SHALL return an array of `{ type, displayName, description, category, configSchema }` derived from the same NodeRegistry the Executor consumes, with `configSchema` emitted as JSON Schema via `zod-to-json-schema`.
4. WHEN any endpoint receives a request body, THE API SHALL validate the body against a Zod schema and SHALL respond with HTTP 400 plus per-field errors on validation failure.
5. THE API SHALL emit responses whose shapes match TypeScript types exported from `packages/shared`.
6. IF `runInput` exceeds 256 KB, THEN THE API SHALL reject the request with HTTP 413 before invoking the Executor.

---

### Requirement 8: UI Scope

**User Story:** As an Operator, I want a small, focused web UI to browse workflows, edit simple ones, trigger runs, and inspect traces, so that I can use the engine without curl.

*(Trace: brief Part A.5 "UI"; design *UI Scope*, *Workflow editor and execution-order semantics*, *UI node discovery*.)*

#### Acceptance Criteria

1. THE Web SHALL render five pages: workflows list, workflow detail (read-only React Flow + JSON tab), workflow editor (selection-order with Branch routing form), run trace, and per-workflow runs list.
2. WHEN the Web loads, THE Web SHALL fetch `GET /node-types` once per session and SHALL use the response to populate the editor palette, drive auto-generated config forms via `@rjsf/core`, and label nodes in graph visualisations.
3. WHEN a new node type is registered and deployed, THE Web SHALL display the new type in the editor palette without any UI code change.
4. WHEN the Operator clicks "Trigger run" on the workflow detail page, THE Web SHALL open a JSON input modal, post the input to `POST /workflows/:id/runs`, and navigate to the run trace page on receipt of the `runId`.
5. WHILE a run's status is non-terminal, THE Web SHALL poll `GET /runs/:id` every 1 second and SHALL update the graph node colours according to per-node status (gray pending, blue running, green succeeded, red failed, dashed gray skipped).
6. WHEN a node is clicked on the run trace page, THE Web SHALL expand a panel showing `input`, `output`, `durationMs`, `attemptCount`, `tokenUsage` (when present), and `error` (when present) for that node.
7. THE Web SHALL NOT include drag-and-drop edge drawing, free-form DAG canvas, authentication screens, or RBAC controls.

---

### Requirement 9: Local Development

**User Story:** As a Reviewer, I want to clone the repo, install dependencies, and run the entire system locally with no AWS account, so that I can evaluate the project in minutes.

*(Trace: brief Constraints "`docker compose up` or `npm run dev` + a local Postgres is fine"; design *Architecture*, *Testing Strategy*.)*

#### Acceptance Criteria

1. WHEN the Reviewer runs `docker compose up`, THE compose stack SHALL start a single Postgres service with the `pgvector` extension installed and SHALL NOT require any AWS service or LocalStack.
2. WHEN the Reviewer runs `pnpm dev`, THE dev runner SHALL start the API (Fastify), the Executor (in-process async function), and the Web (Vite dev server) concurrently against the local Postgres.
3. WHEN running locally with no `LLM_PROVIDER` env var set, THE Engine SHALL default to `fake`.
4. WHEN the Reviewer runs the full test suite, THE tests SHALL pass with no AWS credentials, no real LLM API key, and no network access beyond `localhost` and Testcontainers.
5. WHEN the Reviewer triggers a run from the local UI, THE Engine SHALL execute the run in-process and persist the trace to local Postgres via `RunRepoPostgres`.

---

### Requirement 10: Testing Strategy

**User Story:** As a Platform Engineer, I want a layered test pyramid that separates software correctness from agent quality, so that CI gates on determinism and not on LLM mood.

*(Trace: brief Part C "C1/C2/C3"; design *Testing Strategy*.)*

#### Acceptance Criteria

1. THE test suite SHALL include unit tests for `topoLevels`, cycle detection, retry policy, `resolveTemplate`, and the Branch/Transform expression sandbox, all running against FakeLLM only.
2. THE test suite SHALL include integration tests using Testcontainers Postgres and FakeLLM that cover at least one full workflow run end-to-end with trace persistence asserted.
3. THE test suite SHALL include a generic plugin-contract test parameterised over any `NodeExecutor`, and every built-in plus the `kb-retrieval` plugin SHALL pass it.
4. THE test suite SHALL include a deterministic retrieval-pipeline test that seeds `tickets_seed` with a fixed corpus, runs the `kb-retrieval` node with a known query, and asserts that the returned document IDs match an expected list in expected order.
5. THE test suite SHALL include an end-to-end eval over 10–20 hand-crafted ops tickets (including ambiguous, multilingual, malformed-body, and edge-case inputs) that asserts on structural correctness only (`urgency ∈ {LOW, MED, HIGH}`, `fetchSimilar.documents.length === 3`, `draftReply.text` non-empty) and SHALL NOT assert on exact LLM wording.
6. WHEN `EVAL_REAL_LLM=1` is set, THE eval SHALL execute against the real LLM provider for the canary cases; otherwise it SHALL execute against FakeLLM and SHALL be safe to run on every commit.
7. THE repository SHALL include a load-test script `scripts/load.ts` that runs N concurrent workflow runs against the local Engine + FakeLLM, that measures throughput and P50/P99 per-node duration, and that SHALL NOT make real LLM calls under any flag combination.
8. THE test suite SHALL distinguish software-correctness tests (deterministic, run on every commit, gating) from agent-quality evals (judged, run nightly with a real-LLM canary, non-gating).

---

### Requirement 11: Deployment and Build

**User Story:** As a Platform Engineer, I want a single build-and-deploy script that bundles each Lambda and updates function code, so that deploys are reproducible without an IaC layer.

*(Trace: brief Constraints "Deployment is not required"; design *Node deployment lifecycle*, *Dependencies*.)*

#### Acceptance Criteria

1. THE build SHALL use esbuild to bundle each Lambda entry point (API and Executor) into a single output file.
2. WHEN `scripts/deploy.sh` is run, THE script SHALL build both bundles, zip each, and call `aws lambda update-function-code` for both `agent-engine-api` and `agent-engine-executor`.
3. THE same Engine source code SHALL execute both locally (Node 20 process) and in AWS Lambda (Node 20 runtime) with no platform-specific branches inside the engine package.
4. THE repository SHALL NOT contain CDK, Terraform, SAM, or other infrastructure-as-code definitions for production resource provisioning.

---

### Requirement 12: Cross-Cutting Constraints

**User Story:** As a Platform Engineer, I want explicit guardrails on secrets, sandboxing, input bounds, and observability, so that the engine remains safe to run as the surface area grows.

*(Trace: design *Security Considerations*, *Performance Considerations*, *Components / Built-in node types*.)*

#### Acceptance Criteria

1. THE Engine SHALL read all LLM API keys from environment variables and SHALL NOT persist any LLM API key in Postgres, DynamoDB, or any workflow definition.
2. THE Branch and Transform nodes SHALL evaluate user-authored expressions exclusively via `expr-eval` and SHALL NOT use `eval`, `vm.runInNewContext`, or `new Function`.
3. WHEN a `WorkflowDef` is submitted, THE API SHALL accept arbitrary JSON content within Zod-defined size and shape limits.
4. WHEN any node's `execute` returns or throws, THE Engine SHALL record `durationMs` measured from the start of `execute` to the resolution of its returned promise.
5. THE Engine SHALL attribute `tokenUsage` from `LLMProvider.complete` to the `llm` node that issued the call and `tokenUsage` from `LLMProvider.embed` to the `kb-retrieval` node that issued the call.
6. IF the request `runInput` exceeds 256 KB, THEN THE API SHALL reject the request before invoking the Executor (see also Requirement 7.6).

---

### Requirement 13: Documentation Deliverables

**User Story:** As a Reviewer, I want three short documents that tell me how to run the system, why it is shaped this way, and how to trust the tests, so that I can evaluate it without asking questions.

*(Trace: brief Deliverables 2/3/4; design ships an inline `DESIGN.md` condensed section as a template.)*

#### Acceptance Criteria

1. THE repository SHALL contain `README.md` covering: how to run locally, what works end-to-end, what is unfinished, how to run the tests, and how to run the load test.
2. THE repository SHALL contain `DESIGN.md` of two pages or fewer covering: data model for workflows/nodes/edges/runs/node-executions, execution ordering and error handling, the plugin mechanism, three design decisions with rejected alternatives, and three things to build next in priority order.
3. THE repository SHALL contain `TESTING.md` of one page or fewer covering: the answers to C1 (data), C2 (integrations), and C3 (load); the test pyramid for this system; one bug the test suite catches today; and one bug it misses today.
4. THE three documents SHALL match the system as actually built — every "works end-to-end" claim in `README.md` SHALL map to a passing test or a runnable command in the repository.

---

## Out of Scope

The following items are deliberate cuts. Each is listed with a one-line rationale. Architectural detail for the cuts lives in design.md under *"What I would build next given another week"* and *"UI Scope / Explicitly cut"*.

- **Authentication, RBAC, SSO, multi-tenancy** — explicitly excluded by the assignment brief; no production-grade access control is in scope.
- **Free-form drag-and-drop DAG editor** — selection-order editor with a Branch routing form covers the V1 vertical; the full canvas is the headline next-week item.
- **Diamond DAGs and multi-Branch series in the UI editor** — the engine accepts them; only the editor UX is cut. Power users post raw `WorkflowDef` via the JSON edit tab.
- **Step Functions / one-Lambda-per-node orchestration** — single-Lambda-per-run keeps local dev identical to prod and stays well inside the 15-minute Lambda budget for the vertical.
- **Runtime plugin loading (Lambda Layers, S3-fetched plugins)** — compile-time registration preserves auditability and bundle determinism; new types ship via redeploy.
- **Per-workflow CPU/memory caps inside the sandbox** — `expr-eval` already eliminates `eval`/`vm`/`new Function`; resource caps are deferred.
- **Reaper for orphaned `RUNNING` runs** — runs left `RUNNING` past `endedAt + 15min` are a documented limitation, not a feature.
- **CDK / Terraform / SAM / managed IaC** — `scripts/deploy.sh` updates Lambda code only; environment provisioning is manual one-time setup.
- **Bedrock Knowledge Base swap** — the `kb-retrieval` interface is shaped to allow it; the alternative implementation is a next-week item.
- **Polished UI / theming / branding** — function over form per the brief.
- **High coverage percentages as a goal** — the brief grades on test judgment; coverage numbers are not a target.
