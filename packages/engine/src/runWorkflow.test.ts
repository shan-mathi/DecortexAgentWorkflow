// `runWorkflow` end-to-end tests against in-memory repos.
//
// These exercise the orchestrator without depending on any specific
// node type — we register synthetic executors per test so the test
// stays focused on orchestration semantics:
//   - linear DAG
//   - diamond DAG (the bug the suite catches: both upstream outputs
//     reach the join node)
//   - Branch + skipped subtree
//   - terminal-on-failure short-circuits the run
//   - parallel level: two siblings observed running concurrently
//   - status sequence (PENDING → RUNNING → terminal) with endedAt set
//   - appendNodeExecution idempotence under retries

import { z } from "zod";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { NodeContext, NodeResult, WorkflowDef } from "@workflow-engine/shared";

import { NodeRegistry, type NodeExecutor } from "./registry.js";
import { runWorkflow } from "./runWorkflow.js";
import { InMemoryRunRepo } from "./testing/inMemoryRepos.js";

function node(
  id: string,
  type: string,
  config: Record<string, unknown> = {},
  pos: [number, number] = [0, 0],
) {
  return { id, type, config, position_x: pos[0], position_y: pos[1] };
}

function defineRegistry(executors: NodeExecutor[]): NodeRegistry {
  const r = new NodeRegistry();
  for (const e of executors) r.register(e);
  return r;
}

function passthroughExecutor(type: string, fn: (cfg: unknown, ctx: NodeContext) => Promise<NodeResult>): NodeExecutor {
  return {
    type,
    configSchema: z.unknown(),
    execute: fn,
  };
}

describe("runWorkflow", () => {
  let runRepo: InMemoryRunRepo;
  const runId = "11111111-1111-4111-8111-111111111111";
  const workflowId = "22222222-2222-4222-8222-222222222222";

  beforeEach(async () => {
    runRepo = new InMemoryRunRepo();
    await runRepo.createRun({ runId, workflowId, input: { x: 1 } });
  });

  afterEach(() => {
    runRepo = new InMemoryRunRepo();
  });

  it("runs a linear DAG and persists every node", async () => {
    const order: string[] = [];
    const registry = defineRegistry([
      passthroughExecutor("step", async (_c, ctx) => {
        order.push(ctx.nodeId);
        return { output: { step: ctx.nodeId }, status: "SUCCEEDED", durationMs: 0 };
      }),
    ]);
    const def: WorkflowDef = {
      id: workflowId,
      name: "t",
      nodes: [node("a", "step"), node("b", "step"), node("c", "step")],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    };

    const r = await runWorkflow(def, { x: 1 }, runId, { registry, runRepo });
    expect(r.status).toBe("SUCCEEDED");
    expect(order).toEqual(["a", "b", "c"]);

    const trace = await runRepo.getRun(runId);
    expect(trace.meta.status).toBe("SUCCEEDED");
    expect(trace.meta.endedAt).toBeInstanceOf(Date);
    expect(trace.nodeExecutions.map((n) => n.nodeId).sort()).toEqual(["a", "b", "c"]);
  });

  it("merges both upstream outputs into a join node's ctx (diamond)", async () => {
    let observed: NodeContext["upstream"] | undefined;
    const registry = defineRegistry([
      passthroughExecutor("emit", async (_c, ctx) => ({
        output: { from: ctx.nodeId },
        status: "SUCCEEDED",
        durationMs: 0,
      })),
      passthroughExecutor("join", async (_c, ctx) => {
        observed = ctx.upstream;
        return { output: null, status: "SUCCEEDED", durationMs: 0 };
      }),
    ]);
    const def: WorkflowDef = {
      id: workflowId,
      name: "diamond",
      nodes: [node("a", "emit"), node("b", "emit"), node("c", "emit"), node("d", "join")],
      edges: [
        { from: "a", to: "b" },
        { from: "a", to: "c" },
        { from: "b", to: "d" },
        { from: "c", to: "d" },
      ],
    };

    const r = await runWorkflow(def, {}, runId, { registry, runRepo });
    expect(r.status).toBe("SUCCEEDED");
    expect(Object.keys(observed ?? {}).sort()).toEqual(["b", "c"]);
  });

  it("skips the non-taken subtree behind a Branch", async () => {
    const ran: string[] = [];
    const registry = defineRegistry([
      passthroughExecutor("classify", async (_c, ctx) => {
        ran.push(ctx.nodeId);
        return { output: { text: "HIGH" }, status: "SUCCEEDED", durationMs: 0 };
      }),
      passthroughExecutor("branch", async (_c, ctx) => {
        ran.push(ctx.nodeId);
        return {
          output: { takenBranch: "high-path" },
          status: "SUCCEEDED",
          durationMs: 0,
        };
      }),
      passthroughExecutor("work", async (_c, ctx) => {
        ran.push(ctx.nodeId);
        return { output: ctx.nodeId, status: "SUCCEEDED", durationMs: 0 };
      }),
    ]);
    const def: WorkflowDef = {
      id: workflowId,
      name: "branch",
      nodes: [
        node("classify", "classify"),
        node("branch", "branch"),
        node("high-path", "work"),
        node("low-path", "work"),
      ],
      edges: [
        { from: "classify", to: "branch" },
        { from: "branch", to: "high-path" },
        { from: "branch", to: "low-path" },
      ],
    };

    const r = await runWorkflow(def, {}, runId, { registry, runRepo });
    expect(r.status).toBe("SUCCEEDED");
    expect(ran).toContain("high-path");
    expect(ran).not.toContain("low-path");

    const trace = await runRepo.getRun(runId);
    const lowPath = trace.nodeExecutions.find((n) => n.nodeId === "low-path");
    expect(lowPath?.status).toBe("SKIPPED");
  });

  it("stops scheduling further levels after a terminal failure", async () => {
    const ran: string[] = [];
    const registry = defineRegistry([
      passthroughExecutor("ok", async (_c, ctx) => {
        ran.push(ctx.nodeId);
        return { output: ctx.nodeId, status: "SUCCEEDED", durationMs: 0 };
      }),
      passthroughExecutor("boom", async () => {
        throw new Error("kaboom");
      }),
    ]);
    const def: WorkflowDef = {
      id: workflowId,
      name: "fail",
      nodes: [
        node("a", "ok"),
        node("b", "boom", { retry: { maxAttempts: 1, backoffMs: 0, jitter: 0 } }),
        node("c", "ok"),
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    };

    const r = await runWorkflow(def, {}, runId, {
      registry,
      runRepo,
      retry: { sleep: () => Promise.resolve() },
    });
    expect(r.status).toBe("FAILED");
    expect(ran).toEqual(["a"]);

    const trace = await runRepo.getRun(runId);
    expect(trace.meta.status).toBe("FAILED");
    expect(trace.meta.endedAt).toBeInstanceOf(Date);
    expect(trace.nodeExecutions.find((n) => n.nodeId === "c")).toBeUndefined();
  });

  it("runs sibling nodes in parallel within a level", async () => {
    const registry = defineRegistry([
      passthroughExecutor("slow", async () => {
        await new Promise((r) => setTimeout(r, 80));
        return { output: null, status: "SUCCEEDED", durationMs: 0 };
      }),
    ]);
    const def: WorkflowDef = {
      id: workflowId,
      name: "par",
      nodes: [node("root", "slow"), node("a", "slow"), node("b", "slow")],
      edges: [
        { from: "root", to: "a" },
        { from: "root", to: "b" },
      ],
    };

    const t0 = Date.now();
    const r = await runWorkflow(def, {}, runId, { registry, runRepo });
    const dt = Date.now() - t0;
    expect(r.status).toBe("SUCCEEDED");
    // Three nodes × 80ms = 240ms serial; parallel level 2 means ~160ms total.
    // Allow generous slack to avoid CI flake.
    expect(dt).toBeLessThan(220);
  });

  it("appendNodeExecution is idempotent on (runId, nodeId)", async () => {
    const registry = defineRegistry([
      passthroughExecutor("ok", async () => ({
        output: 1,
        status: "SUCCEEDED",
        durationMs: 0,
      })),
    ]);
    const def: WorkflowDef = {
      id: workflowId,
      name: "x",
      nodes: [node("a", "ok")],
      edges: [],
    };
    await runWorkflow(def, {}, runId, { registry, runRepo });
    // Manually attempt to write a duplicate — should be a silent no-op.
    await runRepo.appendNodeExecution(runId, {
      nodeId: "a",
      input: null,
      output: "duplicate",
      status: "SUCCEEDED",
      durationMs: 999,
      attemptCount: 1,
      startedAt: new Date(),
    });
    const trace = await runRepo.getRun(runId);
    const ne = trace.nodeExecutions.find((n) => n.nodeId === "a");
    expect(ne?.output).toBe(1); // first write wins
  });
});
