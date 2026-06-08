// DAG validation and topological levelling.
// Ported from packages/engine/src/dag.ts — same algorithm, adapted
// to the new WorkflowFull type.

import type { WorkflowFull } from "../workflow/workflow-service.js";

export type ValidateResult =
  | { ok: true }
  | { ok: false; errors: ValidationError[] };

export type ValidationError =
  | { kind: "duplicate-node-id"; nodeId: string }
  | { kind: "dangling-edge-from"; from: string; to: string }
  | { kind: "dangling-edge-to"; from: string; to: string }
  | { kind: "cycle"; nodeIds: string[] };

export function validateDag(wf: WorkflowFull): ValidateResult {
  const errors: ValidationError[] = [];
  const nodeIds = new Set<string>(); //visited nodes


  for (const n of wf.nodes) {
    if (nodeIds.has(n.nodeId)) {
      errors.push({ kind: "duplicate-node-id", nodeId: n.nodeId });
    } else {
      nodeIds.add(n.nodeId);
    }
  }

  for (const e of wf.edges) {
    if (!nodeIds.has(e.from)) errors.push({ kind: "dangling-edge-from", from: e.from, to: e.to });
    if (!nodeIds.has(e.to)) errors.push({ kind: "dangling-edge-to", from: e.from, to: e.to });
  }

  const cycleNodes = detectCycles(wf);
  if (cycleNodes) errors.push({ kind: "cycle", nodeIds: cycleNodes });

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

//DFS cycle-detection algorithm 

function detectCycles(wf: WorkflowFull): string[] | null {
  const adj = new Map<string, string[]>();
  for (const n of wf.nodes) adj.set(n.nodeId, []);
  for (const e of wf.edges) adj.get(e.from)?.push(e.to);

  // Tracks node visitation states using numbers:
  // WHITE (0): Unvisited (not yet processed).
  // GRAY (1): Currently being visited (currently in the active DFS recursion stack/path).
  // BLACK (2): Fully processed (all outgoing paths from this node have been explored without finding cycles).
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const colour = new Map<string, number>();
  for (const n of wf.nodes) colour.set(n.nodeId, WHITE);

  const stack: string[] = [];
  function dfs(u: string): string[] | null {
    colour.set(u, GRAY);
    stack.push(u);
    for (const v of adj.get(u) ?? []) {
      const c = colour.get(v) ?? WHITE;
      if (c === WHITE) { const cycle = dfs(v); if (cycle) return cycle; }
      else if (c === GRAY) { return stack.slice(stack.indexOf(v)).concat(v); }
    }
    stack.pop();
    colour.set(u, BLACK);
    return null;
  }

  for (const n of wf.nodes) {
    if ((colour.get(n.nodeId) ?? WHITE) === WHITE) {
      const cycle = dfs(n.nodeId);
      if (cycle) return cycle;
    }
  }
  return null;
}

export interface TopoNode {
  nodeId: string;
  registeredNodeId: string;
  name: string | null;
  configOverride: unknown;
}

//Topological sort using Kahn's algorithm

export function topoLevels(wf: WorkflowFull): TopoNode[][] {
  const byId = new Map(wf.nodes.map((n) => [n.nodeId, n]));
  const inDeg = new Map<string, number>();
  for (const n of wf.nodes) inDeg.set(n.nodeId, 0);
  for (const e of wf.edges) inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);

  const out = new Map<string, string[]>();
  for (const n of wf.nodes) out.set(n.nodeId, []);
  for (const e of wf.edges) out.get(e.from)?.push(e.to);

  const levels: TopoNode[][] = [];
  let current = wf.nodes.filter((n) => (inDeg.get(n.nodeId) ?? 0) === 0);
  let placed = 0;

  while (current.length > 0) {
    levels.push(current.map((n) => ({
      nodeId: n.nodeId,
      registeredNodeId: n.registeredNodeId,
      name: n.name,
      configOverride: n.configOverride,
    })));
    placed += current.length;
    const next: typeof current = [];
    for (const n of current) {
      for (const v of out.get(n.nodeId) ?? []) {
        const d = (inDeg.get(v) ?? 0) - 1;
        inDeg.set(v, d);
        if (d === 0) {
          const node = byId.get(v);
          if (node) next.push(node);
        }
      }
    }
    current = next;
  }

  if (placed < wf.nodes.length) throw new Error("cycle detected");
  return levels;
}
