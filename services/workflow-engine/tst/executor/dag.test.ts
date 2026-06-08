import { describe, expect, it } from "vitest";

import { topoLevels, validateDag } from "../../src/executor/dag.js";
import type { WorkflowFull } from "../../src/db/workflow-repository.js";

function makeWorkflow(
  nodes: Array<{ nodeId: string }>,
  edges: Array<{ from: string; to: string }>,
): WorkflowFull {
  return {
    id: "wf-1",
    name: "test",
    description: null,
    version: 1,
    nodes: nodes.map((n) => ({
      nodeId: n.nodeId,
      registeredNodeId: "reg-1",
      name: null,
      configOverride: {},
      positionX: 0,
      positionY: 0,
    })),
    edges: edges.map((e) => ({ from: e.from, to: e.to, conditionExpression: null })),
  };
}

describe("validateDag", () => {
  it("accepts a valid linear DAG", () => {
    const wf = makeWorkflow([{ nodeId: "a" }, { nodeId: "b" }], [{ from: "a", to: "b" }]);
    const r = validateDag(wf);
    expect(r.ok).toBe(true);
  });

  it("detects duplicate node IDs", () => {
    const wf = makeWorkflow([{ nodeId: "a" }, { nodeId: "a" }], []);
    const r = validateDag(wf);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.kind === "duplicate-node-id")).toBe(true);
  });

  it("detects dangling edge (from)", () => {
    const wf = makeWorkflow([{ nodeId: "a" }], [{ from: "ghost", to: "a" }]);
    const r = validateDag(wf);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.kind === "dangling-edge-from")).toBe(true);
  });

  it("detects dangling edge (to)", () => {
    const wf = makeWorkflow([{ nodeId: "a" }], [{ from: "a", to: "ghost" }]);
    const r = validateDag(wf);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.kind === "dangling-edge-to")).toBe(true);
  });

  it("detects cycles", () => {
    const wf = makeWorkflow(
      [{ nodeId: "a" }, { nodeId: "b" }],
      [{ from: "a", to: "b" }, { from: "b", to: "a" }],
    );
    const r = validateDag(wf);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.kind === "cycle")).toBe(true);
  });

  it("aggregates multiple errors", () => {
    const wf = makeWorkflow(
      [{ nodeId: "a" }, { nodeId: "a" }],
      [{ from: "a", to: "ghost" }],
    );
    const r = validateDag(wf);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe("topoLevels", () => {
  it("returns a single level for isolated nodes", () => {
    const wf = makeWorkflow([{ nodeId: "a" }, { nodeId: "b" }], []);
    const levels = topoLevels(wf);
    expect(levels).toHaveLength(1);
    expect(levels[0]!.map((n) => n.nodeId).sort()).toEqual(["a", "b"]);
  });

  it("returns linear levels for a chain", () => {
    const wf = makeWorkflow(
      [{ nodeId: "a" }, { nodeId: "b" }, { nodeId: "c" }],
      [{ from: "a", to: "b" }, { from: "b", to: "c" }],
    );
    const levels = topoLevels(wf);
    expect(levels.map((l) => l.map((n) => n.nodeId))).toEqual([["a"], ["b"], ["c"]]);
  });

  it("groups siblings into the same level (diamond)", () => {
    const wf = makeWorkflow(
      [{ nodeId: "a" }, { nodeId: "b" }, { nodeId: "c" }, { nodeId: "d" }],
      [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "d" }, { from: "c", to: "d" }],
    );
    const levels = topoLevels(wf);
    expect(levels[0]!.map((n) => n.nodeId)).toEqual(["a"]);
    expect(levels[1]!.map((n) => n.nodeId).sort()).toEqual(["b", "c"]);
    expect(levels[2]!.map((n) => n.nodeId)).toEqual(["d"]);
  });

  it("throws on a cycle", () => {
    const wf = makeWorkflow(
      [{ nodeId: "a" }, { nodeId: "b" }],
      [{ from: "a", to: "b" }, { from: "b", to: "a" }],
    );
    expect(() => topoLevels(wf)).toThrow(/cycle/i);
  });

  it("property: for every edge (u,v), level(u) < level(v)", () => {
    // Random DAG: nodes with ranks, edges only from lower to higher rank
    let seed = 42;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff; };

    for (let trial = 0; trial < 30; trial++) {
      const N = 3 + Math.floor(rand() * 10);
      const nodes = Array.from({ length: N }, (_, i) => ({ nodeId: `n${i}` }));
      const edges: Array<{ from: string; to: string }> = [];
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          if (rand() < 0.3) edges.push({ from: `n${i}`, to: `n${j}` });
        }
      }
      const wf = makeWorkflow(nodes, edges);
      const levels = topoLevels(wf);
      const levelOf = new Map<string, number>();
      levels.forEach((lvl, idx) => lvl.forEach((n) => levelOf.set(n.nodeId, idx)));
      for (const e of edges) {
        expect(levelOf.get(e.from)!).toBeLessThan(levelOf.get(e.to)!);
      }
    }
  });
});
