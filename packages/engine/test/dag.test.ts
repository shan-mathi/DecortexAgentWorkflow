// Tests for `validateDag` and `topoLevels`.
//
// `topoLevels` gets a small property test (random DAG generator) plus
// a few hand-shaped fixtures. The property is the design's
// guarantee: "every edge (u, v) has level(u) < level(v)".
//
// `validateDag` is exercised across each violation kind individually,
// then once together to assert that the function aggregates rather
// than fails on the first.

import { describe, expect, it } from "vitest";

import type { WorkflowDef } from "@workflow-engine/shared";

import { topoLevels, validateDag } from "../src/dag.js";

function node(id: string, type = "transform") {
  return { id, type, config: {}, position_x: 0, position_y: 0 };
}

function makeDef(
  nodes: Array<{ id: string; type?: string }>,
  edges: Array<{ from: string; to: string }>,
): WorkflowDef {
  return {
    name: "test",
    nodes: nodes.map((n) => node(n.id, n.type ?? "transform")),
    edges: edges.map((e) => ({ from: e.from, to: e.to })),
  };
}

describe("topoLevels", () => {
  it("returns a single level for an isolated node", () => {
    const levels = topoLevels(makeDef([{ id: "a" }], []));
    expect(levels).toHaveLength(1);
    expect(levels[0]?.map((n) => n.id)).toEqual(["a"]);
  });

  it("returns linear levels for a chain", () => {
    const levels = topoLevels(
      makeDef(
        [{ id: "a" }, { id: "b" }, { id: "c" }],
        [
          { from: "a", to: "b" },
          { from: "b", to: "c" },
        ],
      ),
    );
    expect(levels.map((l) => l.map((n) => n.id))).toEqual([["a"], ["b"], ["c"]]);
  });

  it("groups siblings into the same level (diamond)", () => {
    // a -> b, a -> c, b -> d, c -> d
    const levels = topoLevels(
      makeDef(
        [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
        [
          { from: "a", to: "b" },
          { from: "a", to: "c" },
          { from: "b", to: "d" },
          { from: "c", to: "d" },
        ],
      ),
    );
    expect(levels[0]?.map((n) => n.id)).toEqual(["a"]);
    expect(levels[1]?.map((n) => n.id).sort()).toEqual(["b", "c"]);
    expect(levels[2]?.map((n) => n.id)).toEqual(["d"]);
  });

  it("throws on a cycle", () => {
    expect(() =>
      topoLevels(
        makeDef(
          [{ id: "a" }, { id: "b" }],
          [
            { from: "a", to: "b" },
            { from: "b", to: "a" },
          ],
        ),
      ),
    ).toThrow(/cycle/i);
  });

  it("property: for every random DAG, level(u) < level(v) for every edge (u,v)", () => {
    // Generate a random DAG by giving each node an integer "rank" and
    // only allowing edges from lower rank to higher rank.
    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };

    for (let trial = 0; trial < 50; trial++) {
      const N = 3 + Math.floor(rand() * 12);
      const nodes = Array.from({ length: N }, (_, i) => ({ id: `n${i}` }));
      const ranks = new Map(nodes.map((n, i) => [n.id, i] as const));
      const edges: Array<{ from: string; to: string }> = [];
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          if (rand() < 0.3) edges.push({ from: `n${i}`, to: `n${j}` });
        }
      }
      const def = makeDef(nodes, edges);
      const levels = topoLevels(def);
      const levelOf = new Map<string, number>();
      levels.forEach((lvl, idx) => lvl.forEach((n) => levelOf.set(n.id, idx)));

      for (const e of edges) {
        const lu = levelOf.get(e.from)!;
        const lv = levelOf.get(e.to)!;
        expect(lu, `edge ${e.from}→${e.to} (ranks ${ranks.get(e.from)}/${ranks.get(e.to)})`).toBeLessThan(lv);
      }
    }
  });
});

describe("validateDag", () => {
  it("ok: simple linear graph", () => {
    const r = validateDag(
      makeDef([{ id: "a" }, { id: "b" }], [{ from: "a", to: "b" }]),
    );
    expect(r.ok).toBe(true);
  });

  it("flags a dangling 'from'", () => {
    const r = validateDag(makeDef([{ id: "a" }], [{ from: "ghost", to: "a" }]));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.kind === "dangling-edge-from")).toBe(true);
    }
  });

  it("flags a dangling 'to'", () => {
    const r = validateDag(makeDef([{ id: "a" }], [{ from: "a", to: "ghost" }]));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.kind === "dangling-edge-to")).toBe(true);
    }
  });

  it("flags duplicate node ids", () => {
    const r = validateDag(makeDef([{ id: "a" }, { id: "a" }], []));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.kind === "duplicate-node-id")).toBe(true);
    }
  });

  it("flags cycles", () => {
    const r = validateDag(
      makeDef(
        [{ id: "a" }, { id: "b" }],
        [
          { from: "a", to: "b" },
          { from: "b", to: "a" },
        ],
      ),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const cycle = r.errors.find((e) => e.kind === "cycle");
      expect(cycle).toBeDefined();
    }
  });

  it("aggregates multiple violations rather than failing fast", () => {
    const r = validateDag(
      makeDef(
        [{ id: "a" }, { id: "a" }, { id: "b" }],
        [
          { from: "a", to: "ghost" },
          { from: "missing", to: "b" },
        ],
      ),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Expect at least: duplicate id, dangling-from, dangling-to.
      expect(r.errors.length).toBeGreaterThanOrEqual(3);
    }
  });
});
