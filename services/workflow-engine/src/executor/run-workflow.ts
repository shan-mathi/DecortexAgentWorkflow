// Executor: resolves and runs a workflow.
//
// Two phases:
//   1. Validate + resolve: check DAG structure, compute topo levels
//   2. Execute: iterate levels, run nodes in parallel, persist traces
//
// All DB access is delegated to RunRepository and NodeRepository —
// this file owns orchestration logic only.

import { randomUUID } from "node:crypto";

import type { NodeContext, NodeExecution, NodeResult, RunStatus } from "../types/index.js";

import type { NodeRegistrationRepository, RegisteredNodeRow } from "../db/node-registration-repository.js";
import type { RunRepository } from "../db/run-repository.js";
import { logger } from "../lib/logger.js";
import type { NodeHandlerRegistry } from "../nodes/node-handler.js";
import type { WorkflowFull } from "../db/workflow-repository.js";
import { topoLevels, validateDag, type TopoNode } from "./dag.js";

export interface ExecutorDeps {
  runRepo: RunRepository;
  nodeRepo: NodeRegistrationRepository;
  handlers: NodeHandlerRegistry;
}

export interface RunResult {
  runId: string;
  status: RunStatus;
}

export async function executeWorkflow(
  workflow: WorkflowFull,
  input: unknown,
  deps: ExecutorDeps,
): Promise<RunResult> {
  const runId = randomUUID();
  const log = logger.child({ runId, workflowId: workflow.id });

  log.info({ workflowName: workflow.name, nodeCount: workflow.nodes.length }, "Execution started");

  // Phase 1: Validate DAG
  const validation = validateDag(workflow);
  if (!validation.ok) {
    log.error({ errors: validation.errors }, "DAG validation failed");
    await deps.runRepo.createRun(runId, workflow.id, input);
    await deps.runRepo.setStatus(runId, "FAILED", new Date());
    return { runId, status: "FAILED" };
  }

  await deps.runRepo.createRun(runId, workflow.id, input);

  // Compute execution order
  const levels = topoLevels(workflow);
  log.info({ levelCount: levels.length }, "DAG resolved into topological levels");

  const nodeIds = workflow.nodes.map((n) => n.registeredNodeId);
  const nodeRegistry = await deps.nodeRepo.getByIds(nodeIds);

  // Phase 2: Execute
  await deps.runRepo.setStatus(runId, "RUNNING");

  const outputs: Record<string, NodeResult> = {};
  const skipped = new Set<string>();

  for (const level of levels) {
    const runnable = level.filter((n) => !skipped.has(n.nodeId));
    const skippedHere = level.filter((n) => skipped.has(n.nodeId));

    // Persist SKIPPED records
    for (const n of skippedHere) {
      outputs[n.nodeId] = { output: null, status: "SKIPPED", durationMs: 0 };
      const reg = nodeRegistry.get(n.registeredNodeId);
      await deps.runRepo.appendNodeExecution(runId, {
        nodeId: n.nodeId,
        registeredNodeId: n.registeredNodeId,
        nodeName: n.name ?? reg?.name,
        nodeType: reg?.category,
        input: null,
        output: null,
        status: "SKIPPED",
        durationMs: 0,
        attemptCount: 1,
        startedAt: new Date(),
      });
    }

    if (runnable.length === 0) continue;

    // Execute all nodes in this level in parallel
    const results = await Promise.all(
      runnable.map((n) => executeNode(n, deps, nodeRegistry, input, outputs, workflow, runId)),
    );

    // Process results
    for (let i = 0; i < runnable.length; i++) {
      const node = runnable[i]!;
      const result = results[i]!;
      outputs[node.nodeId] = result;

      // If branch, mark non-taken subtrees as skipped
      if (result.status === "SUCCEEDED") {
        const taken = (result.output as { takenBranch?: string } | null)?.takenBranch;
        if (typeof taken === "string") {
          markNonTakenSubtree(workflow, node.nodeId, taken, skipped);
        }
      }

      // Terminal on failure
      if (result.status === "FAILED") {
        log.error({ nodeId: node.nodeId, error: result.error?.message }, "Node failed, terminating run");
        await deps.runRepo.setStatus(runId, "FAILED", new Date());
        return { runId, status: "FAILED" };
      }
    }
  }

  log.info({ status: "SUCCEEDED" }, "Execution completed successfully");
  await deps.runRepo.setStatus(runId, "SUCCEEDED", new Date());
  return { runId, status: "SUCCEEDED" };
}

async function executeNode(
  node: TopoNode,
  deps: ExecutorDeps,
  nodeRegistry: Map<string, RegisteredNodeRow>,
  runInput: unknown,
  outputs: Record<string, NodeResult>,
  workflow: WorkflowFull,
  runId: string,
): Promise<NodeResult> {
  const log = logger.child({ runId, nodeId: node.nodeId, workflowId: workflow.id });
  const reg = nodeRegistry.get(node.registeredNodeId);
  if (!reg) {
    log.error({}, "Registered node not found");
    const result: NodeResult = {
      output: null,
      status: "FAILED",
      durationMs: 0,
      error: { message: `Registered node not found: ${node.registeredNodeId}` },
    };
    await deps.runRepo.appendNodeExecution(runId, {
      nodeId: node.nodeId,
      registeredNodeId: node.registeredNodeId,
      nodeName: node.name ?? undefined,
      nodeType: undefined,
      input: null,
      output: null,
      status: "FAILED",
      durationMs: 0,
      attemptCount: 1,
      startedAt: new Date(),
      error: result.error,
    });
    return result;
  }

  const handler = deps.handlers.get(reg.category);
  log.info({ nodeType: reg.category, nodeName: reg.name }, "Node execution starting");

  // Merge: registered node config + workflow-level override
  const mergedConfig = { ...(reg.config as object), ...(node.configOverride as object ?? {}) };

  // Build context with all ancestor outputs
  const upstream = allAncestorOutputs(workflow, node.nodeId, outputs);
  const ctx: NodeContext = {
    runId,
    nodeId: node.nodeId,
    runInput,
    upstream,
    metadata: { workflowId: workflow.id, attempt: 1 },
  };

  // Execute with retry
  const result = await executeWithRetry(handler, mergedConfig, ctx, 3);
  log.info({
    nodeType: reg.category,
    status: result.status,
    durationMs: result.durationMs,
    tokenUsage: result.tokenUsage,
    error: result.error?.message,
  }, "Node execution completed");

  // Persist trace
  await deps.runRepo.appendNodeExecution(runId, {
    nodeId: node.nodeId,
    registeredNodeId: node.registeredNodeId,
    nodeName: node.name ?? reg.name,
    nodeType: reg.category,
    input: { runInput, upstreamKeys: Object.keys(upstream), config: mergedConfig },
    output: result.output,
    status: result.status,
    durationMs: result.durationMs,
    attemptCount: ctx.metadata.attempt,
    startedAt: new Date(),
    tokenUsage: result.tokenUsage,
    error: result.error,
  });

  return result;
}

async function executeWithRetry(
  handler: { execute: (config: unknown, ctx: NodeContext) => Promise<NodeResult> },
  config: unknown,
  ctx: NodeContext,
  maxAttempts: number,
): Promise<NodeResult> {
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    ctx.metadata.attempt = attempt;
    const started = Date.now();
    try {
      const r = await handler.execute(config, ctx);
      r.durationMs = Date.now() - started;
      return r;
    } catch (err) {
      if (attempt === maxAttempts) {
        return {
          output: null,
          status: "FAILED",
          error: { message: (err as Error).message, stack: (err as Error).stack },
          durationMs: Date.now() - started,
        };
      }
      const backoff = 200 * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw new Error("unreachable");
}

function allAncestorOutputs(
  workflow: WorkflowFull,
  nodeId: string,
  outputs: Record<string, NodeResult>,
): Record<string, NodeResult> {
  const ancestors = new Set<string>();
  const stack: string[] = [];
  for (const e of workflow.edges) if (e.to === nodeId) stack.push(e.from);
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (ancestors.has(cur)) continue;
    ancestors.add(cur);
    for (const e of workflow.edges) if (e.to === cur) stack.push(e.from);
  }
  const u: Record<string, NodeResult> = {};
  for (const id of ancestors) {
    const r = outputs[id];
    if (r) u[id] = r;
  }
  return u;
}

function markNonTakenSubtree(
  workflow: WorkflowFull,
  branchId: string,
  taken: string,
  skipped: Set<string>,
): void {
  const out = new Map<string, string[]>();
  for (const n of workflow.nodes) out.set(n.nodeId, []);
  for (const e of workflow.edges) out.get(e.from)?.push(e.to);

  const queue: string[] = [];
  for (const child of out.get(branchId) ?? []) {
    if (child !== taken) queue.push(child);
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (skipped.has(id) || id === taken) continue;
    skipped.add(id);
    for (const c of out.get(id) ?? []) queue.push(c);
  }
}
