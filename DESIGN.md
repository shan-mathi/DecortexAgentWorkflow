# DESIGN.md

The full architectural document is `.kiro/specs/agent-workflow-engine/design.md`. This is the 2-page condensation that the brief asks for.

## Data model

**Postgres** (Aurora-compatible; local dev via `docker compose`):

- `workflows(id, name, description, version, definition jsonb, created_at, updated_at)`
- `nodes(id, workflow_id, node_id, type, name, config jsonb, position_x, position_y)`, unique on `(workflow_id, node_id)`
- `edges(id, workflow_id, from_node, to_node, condition_expression?)`
- `runs(run_id, workflow_id, status, input jsonb, started_at, ended_at?)`, indexed on `(workflow_id, started_at)`
- `node_executions(run_id, node_id, input, output, status, duration_ms, error?, attempt_count, started_at, token_usage?)`, primary key `(run_id, node_id)` — guarantees idempotent appends
- `tickets_seed(id, subject, body, resolution, urgency, embedding vector(1536))` — IVFFlat index on `embedding` for cosine retrieval

**Why pgvector + a separate `kb-retrieval` node, not "give the LLM database access":** retrieval is its own primitive — a deterministic, traced graph node with its own input, output, status, duration, and token attribution. Tests can assert on row IDs without conflating with LLM mood. The brief's "decompose the problem into your platform's primitives" question pushes for this distinction.

For AWS, the design splits run traces into DynamoDB single-table (`PK=RUN#{runId}`); same `RunRepo` interface, different implementation. The engine never knows which one it has. The DDB implementation is left for next week per the brief's "deployment is not required" relaxation.

## Execution ordering and error handling

`validateDag` aggregates every violation (cycles, dangling edges, unknown node types). `topoLevels` runs Kahn's algorithm and returns `NodeDef[][]` — each inner level is `Promise.all`-ed by the executor, which is what makes "parallelism where the DAG allows" cheap (no scheduler).

`runNodeWithRetry` wraps every node call: default policy is 3 attempts, 200 ms base, exponential backoff with 30% jitter; per-node override via `node.config.retry`. The wrapper always returns a `NodeResult` (never throws), sets `durationMs` authoritatively, and increments `ctx.metadata.attempt`. `NonRetryableError` short-circuits the loop — sandbox / template / unmatched-Branch errors don't get retried.

Branch nodes evaluate a sandboxed `expr-eval` expression and return `{ takenBranch }`. `runWorkflow` walks the non-taken downstream subtree and persists `SKIPPED` records for each — a join node downstream of *both* branches is detected and not skipped.

Status sequence is exactly `PENDING → RUNNING → (SUCCEEDED | FAILED)`. `endedAt` is set on terminal. On terminal-on-failure, the executor stops scheduling further levels but every previously-completed node's record is already persisted — the trace is a complete causal record.

## Plugin model — what a new node author writes

```ts
class MyNode implements NodeExecutor<MyConfig> {
  type = "my-node";
  configSchema = z.object({ /* ... */ });
  async execute(config: MyConfig, ctx: NodeContext): Promise<NodeResult> { /* ... */ }
}
// in registerNodes.ts:
registry.register(new MyNode());
```

That is the full diff. No executor change. The four built-ins (`llm`, `http`, `branch`, `transform`) and the `kb-retrieval` plugin all register the same way. A generic plugin-contract test (`packages/engine/src/testing/pluginContract.ts`) is parameterised over a `NodeExecutor` and asserts: `configSchema` rejects clearly invalid configs, `execute` returns a well-formed `NodeResult` for at least one happy-path config, and thrown errors surface as `status: "FAILED"` via the retry wrapper. Every node type passes this suite — that is what makes "plugin model" a real contract.

The same registry is consumed by both the executor (dispatch) and the API (`GET /node-types`, which converts each Zod schema to JSON Schema and surfaces it to the UI palette and RJSF auto-form). When a new node type is registered and deployed, it appears in the editor without any UI change.

## Three design decisions with rejected alternatives

1. **One Lambda per run, not per node (rejected: Step Functions / SQS fan-out per node).** *Tradeoff:* 15-minute ceiling per run. *Gain:* zero orchestration overhead, no cold start × N nodes per run, identical local and deployed code paths (`pnpm dev` works with no AWS). For the ops-ticket-router (5 nodes, ~10s P99), there's two orders of magnitude of headroom.

2. **Postgres + DynamoDB, not single store (rejected: Postgres-only with a partitioned `node_executions` table).** *Tradeoff:* two SDKs, two test setups, one extra abstraction (`RunRepo`). *Gain:* each access pattern uses its right tool — definitions are joined and small (relational fits), traces are append-heavy and grow without bound (DDB scales horizontally). Splitting also lets local dev use `RunRepoPostgres` (no DDB-local complexity in CI). The current build ships only the Postgres `RunRepo`; the DDB implementation is the next-week item.

3. **FakeLLM as a first-class deployable provider, not a `vi.mock` (rejected: a test-only stub).** *Tradeoff:* more production code — canned-response loading, latency distribution sampling, failure-mode generators. *Gain:* the *same* fake powers unit tests, integration tests, the load script, `pnpm dev`, and (eventually) a prod canary. We can test timeout/rate-limit/malformed-JSON branches at zero cost and full determinism. A test-only mock could not be deployed and would diverge from production over time.

## Three things to build next given another week (priority order)

1. **Step Functions migration**: one Lambda per node, Step Functions choreographing. Removes the 15-min ceiling and unlocks human-approval steps. The engine already exposes a single-node `runNodeWithRetry`; Step Functions just calls it per state. Cost: an IaC layer + a reaper for orphaned `RUNNING` rows.
2. **Bedrock Knowledge Base swap behind the existing `kb-retrieval` interface**: replace pgvector with Amazon Bedrock KB over an S3 vector store. Workflow definitions don't change; only the `KnowledgeBaseRetrievalNode` implementation does. This is the precise abstraction win that motivated making retrieval a node in the first place.
3. **Free-form DAG editor canvas**: today's selection-order editor handles linear flows + a single Branch. The next jump is drag-and-drop edges supporting diamond DAGs and multi-Branch series. The engine already accepts these — the work is purely UX.
