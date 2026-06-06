// `runWorkflow` — top-level orchestrator.
//
// Algorithm in plain English:
//   1. Validate the DAG against the registry.
//   2. Compute topological levels.
//   3. Set run status to RUNNING.
//   4. For each level, run all nodes in parallel via `Promise.all`,
//      skipping any node already in the `skipped` set.
//   5. After each node, append its execution record (with idempotency
//      guaranteed by the repo).
//   6. After a Branch node returns, mark non-taken downstream subtrees
//      as SKIPPED and persist a record for each.
//   7. On terminal-on-failure, set FAILED and return without scheduling
//      more levels.
//   8. Otherwise set SUCCEEDED on the last level.
//
// Status sequence: PENDING → RUNNING → (SUCCEEDED | FAILED).
//
// The engine never imports an HTTP framework, AWS SDK, or storage
// driver — `deps` injection is the seam.

import type {
  EdgeDef,
  LLMProvider,
  NodeContext,
  NodeDef,
  NodeExecution,
  NodeResult,
  RunStatus,
  WorkflowDef,
} from "@workflow-engine/shared";

import { topoLevels, validateDag } from "./dag.js";
import { type NodeExecutor, NodeRegistry } from "./registry.js";
import type { RunRepo } from "./repo.js";
import { runNodeWithRetry } from "./retry.js";

export interface RunDeps {
  registry: NodeRegistry;
  runRepo: RunRepo;
  llm?: LLMProvider;
  /**
   * Repository deps for nodes that need them (e.g. `kb-retrieval`).
   * Engine does not import a Postgres driver — `pg` is opaque here.
   */
  pg?: unknown;
  now?: () => Date;
  /** Used by `runNodeWithRetry`; injected here so tests can wire in a fake clock. */
  retry?: { now?: () => number; sleep?: (ms: number) => Promise<void>; rng?: () => number };
}

export interface RunResultSummary {
  status: RunStatus;
  outputs: Record<string, NodeResult>;
}

/**
 * Run `workflowDef` against `runInput` and persist the trace via
 * `deps.runRepo`. Pre/post conditions and invariants are documented in
 * the design pseudocode.
 */
export async function runWorkflow(
  workflowDef: WorkflowDef,
  runInput: unknown,
  runId: string,
  deps: RunDeps,
): Promise<RunResultSummary> {
  const validation = validateDag(workflowDef, deps.registry);
  if (!validation.ok) {
    await deps.runRepo.setRunStatus(runId, "FAILED", (deps.now ?? defaultNow)());
    return { status: "FAILED", outputs: {} };
  }

  const levels = topoLevels(workflowDef);
  const outputs: Record<string, NodeResult> = {};
  const skipped = new Set<string>();
  const seen = new Set<string>(); // append-idempotency guard

  await deps.runRepo.setRunStatus(runId, "RUNNING");

  const workflowId = workflowDef.id ?? "unknown";

  for (const level of levels) {
    const runnable = level.filter((n) => !skipped.has(n.id));
    const skippedHere = level.filter((n) => skipped.has(n.id));

    // Persist SKIPPED records for nodes pruned by an upstream Branch.
    for (const n of skippedHere) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      const ne = makeSkipped(n.id, (deps.now ?? defaultNow)());
      outputs[n.id] = {
        output: null,
        status: "SKIPPED",
        durationMs: 0,
      };
      await deps.runRepo.appendNodeExecution(runId, ne);
    }

    if (runnable.length === 0) continue;

    const results = await Promise.all(
      runnable.map((n) =>
        runOne(n, deps, {
          runId,
          nodeId: n.id,
          runInput,
          upstream: parentOutputs(workflowDef.edges, n.id, outputs),
          metadata: { workflowId, attempt: 0 },
        }),
      ),
    );

    for (let i = 0; i < runnable.length; i++) {
      const node = runnable[i]!;
      const result = results[i]!;
      outputs[node.id] = result;

      if (!seen.has(node.id)) {
        seen.add(node.id);
        await deps.runRepo.appendNodeExecution(runId, {
          nodeId: node.id,
          input: snapshotInput(node, runInput, outputs),
          output: result.output,
          status: result.status,
          durationMs: result.durationMs,
          error: result.error,
          attemptCount: ((result as { _attempts?: number })._attempts ?? 1),
          startedAt: (deps.now ?? defaultNow)(),
          tokenUsage: result.tokenUsage,
        });
      }

      if (
        result.status === "FAILED" &&
        isTerminalOnFailure(node)
      ) {
        await deps.runRepo.setRunStatus(runId, "FAILED", (deps.now ?? defaultNow)());
        return { status: "FAILED", outputs };
      }

      if (node.type === "branch" && result.status === "SUCCEEDED") {
        const taken = (result.output as { takenBranch?: string } | null)?.takenBranch;
        if (typeof taken === "string") {
          markNonTakenSubtree(workflowDef, node.id, taken, skipped);
        }
      }
    }
  }

  // If any node finished FAILED but wasn't terminal, the run is still FAILED.
  const anyFailed = Object.values(outputs).some((r) => r.status === "FAILED");
  const final: RunStatus = anyFailed ? "FAILED" : "SUCCEEDED";
  await deps.runRepo.setRunStatus(runId, final, (deps.now ?? defaultNow)());
  return { status: final, outputs };
}

function defaultNow(): Date {
  return new Date();
}

function isTerminalOnFailure(node: NodeDef): boolean {
  const cfg = (node.config ?? {}) as { terminalOnFailure?: boolean };
  // Default: a failed node fails the run. `terminalOnFailure: false` is
  // the opt-out for "best effort" nodes.
  return cfg.terminalOnFailure !== false;
}

function makeSkipped(nodeId: string, startedAt: Date): NodeExecution {
  return {
    nodeId,
    input: null,
    output: null,
    status: "SKIPPED",
    durationMs: 0,
    attemptCount: 1,
    startedAt,
  };
}

/**
 * Build `ctx.upstream` from immediate parents using the edge list.
 *
 * This is the function whose absence is the diamond-DAG bug the
 * integration suite catches: a level-local lookup would only see one
 * parent's result.
 */
function parentOutputs(
  edges: EdgeDef[],
  nodeId: string,
  outputs: Record<string, NodeResult>,
): Record<string, NodeResult> {
  const u: Record<string, NodeResult> = {};
  for (const e of edges) {
    if (e.to !== nodeId) continue;
    const r = outputs[e.from];
    if (r) u[e.from] = r;
  }
  return u;
}

function snapshotInput(
  node: NodeDef,
  runInput: unknown,
  outputs: Record<string, NodeResult>,
): unknown {
  // Persisted "input" is the run-level input plus a snapshot of upstream
  // outputs, which is what the trace UI surfaces. We deliberately
  // include the parent ids only — if a future debugger needs the full
  // ancestor chain it can compute it from the workflow def.
  return {
    runInput,
    upstreamSummary: Object.fromEntries(
      Object.entries(outputs).map(([k, v]) => [k, v.output]),
    ),
    nodeConfig: node.config,
  };
}

async function runOne(
  node: NodeDef,
  deps: RunDeps,
  ctx: NodeContext,
): Promise<NodeResult & { _attempts?: number }> {
  const executor: NodeExecutor = deps.registry.get(node.type);
  // Capture attempt count for the trace record.
  const probe = { ...ctx };
  const r = await runNodeWithRetry(node, executor, probe, deps.retry);
  (r as { _attempts?: number })._attempts = probe.metadata.attempt;
  return r;
}

/**
 * Walk the subtree rooted at every non-`taken` immediate child of `branchId`
 * and add each visited node id to `skipped`.
 *
 * Stops at any node already in `skipped` (no double-traversal) and at
 * any node that is the `taken` branch (so a join node downstream of
 * both branches is NOT skipped).
 */
function markNonTakenSubtree(
  def: WorkflowDef,
  branchId: string,
  taken: string,
  skipped: Set<string>,
): void {
  const out = new Map<string, string[]>();
  for (const n of def.nodes) out.set(n.id, []);
  for (const e of def.edges) out.get(e.from)?.push(e.to);

  const inEdges = new Map<string, string[]>();
  for (const n of def.nodes) inEdges.set(n.id, []);
  for (const e of def.edges) inEdges.get(e.to)?.push(e.from);

  const queue: string[] = [];
  for (const child of out.get(branchId) ?? []) {
    if (child !== taken) queue.push(child);
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (skipped.has(id)) continue;
    if (id === taken) continue;
    // Don't skip a node that has a non-skipped, non-branch parent that
    // would still execute — i.e., a join node downstream of both
    // branches. We approximate by checking: does this node have any
    // parent that is reachable WITHOUT going through the branch's
    // non-taken side? If yes, leave it alone.
    if (hasAlternateParent(id, branchId, taken, inEdges, skipped, def)) continue;
    skipped.add(id);
    for (const c of out.get(id) ?? []) queue.push(c);
  }
}

/**
 * True iff `id` has at least one parent that does NOT trace back
 * exclusively through the non-taken side of `branchId`.
 *
 * In practice: if a parent is the taken target (or downstream of it),
 * the join node should still execute. This is conservative — we only
 * skip a node when EVERY path into it goes through the non-taken side.
 */
function hasAlternateParent(
  id: string,
  branchId: string,
  taken: string,
  inEdges: Map<string, string[]>,
  skipped: Set<string>,
  def: WorkflowDef,
): boolean {
  const parents = inEdges.get(id) ?? [];
  if (parents.length <= 1) return false;
  // BFS upward from each parent; if any parent has a path to an ancestor
  // that is NOT the branch and NOT downstream of the non-taken side,
  // treat it as alternate.
  for (const p of parents) {
    if (skipped.has(p)) continue;
    if (p === branchId) continue;
    // If `p` is the taken target, this is definitely an alternate path.
    if (p === taken) return true;
    if (reachableFromTaken(p, taken, def)) return true;
  }
  return false;
}

function reachableFromTaken(target: string, taken: string, def: WorkflowDef): boolean {
  if (target === taken) return true;
  const out = new Map<string, string[]>();
  for (const n of def.nodes) out.set(n.id, []);
  for (const e of def.edges) out.get(e.from)?.push(e.to);
  const stack = [taken];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const u = stack.pop()!;
    if (seen.has(u)) continue;
    seen.add(u);
    if (u === target) return true;
    for (const v of out.get(u) ?? []) stack.push(v);
  }
  return false;
}
