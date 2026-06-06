// DAG validation and topological levelling.
//
// `validateDag` aggregates every violation rather than failing on the
// first — the API surfaces the full list to the user so they can fix
// their workflow in one round-trip rather than one error per save.
//
// `topoLevels` groups nodes by depth (Kahn's algorithm) so each inner
// list can be `Promise.all`-ed by the executor. This is what makes
// "parallelism where the DAG allows it" cheap — no scheduler, just
// levels.

import type { EdgeDef, NodeDef, WorkflowDef } from "@workflow-engine/shared";

import type { NodeRegistry } from "./registry.js";

export type ValidateResult =
  | { ok: true }
  | { ok: false; errors: ValidationError[] };

export type ValidationError =
  | { kind: "duplicate-node-id"; nodeId: string }
  | { kind: "dangling-edge-from"; edge: EdgeDef }
  | { kind: "dangling-edge-to"; edge: EdgeDef }
  | { kind: "unknown-node-type"; nodeId: string; type: string }
  | { kind: "cycle"; nodeIds: string[] };

/**
 * Validate the structural and registry-level invariants of a workflow.
 *
 * Pre:  `def` has already passed Zod validation.
 * Post: returns `{ok: true}` iff (a) node ids are unique, (b) every edge
 *       references a defined node, (c) every node type is in the
 *       registry, (d) the graph is acyclic.
 *
 * The function does NOT mutate `def`.
 */
export function validateDag(
  def: WorkflowDef,
  registry?: NodeRegistry,
): ValidateResult {
  const errors: ValidationError[] = [];
  const seen = new Set<string>();

  for (const n of def.nodes) {
    if (seen.has(n.id)) {
      errors.push({ kind: "duplicate-node-id", nodeId: n.id });
    } else {
      seen.add(n.id);
    }
    if (registry && !registry.has(n.type)) {
      errors.push({ kind: "unknown-node-type", nodeId: n.id, type: n.type });
    }
  }

  for (const e of def.edges) {
    if (!seen.has(e.from)) errors.push({ kind: "dangling-edge-from", edge: e });
    if (!seen.has(e.to)) errors.push({ kind: "dangling-edge-to", edge: e });
  }

  // Cycle check: only meaningful if every edge endpoint exists. If we
  // already saw dangling edges we still attempt cycle detection over the
  // resolvable subgraph so the error list is as informative as possible.
  const cycleNodes = detectCycles(def);
  if (cycleNodes) errors.push({ kind: "cycle", nodeIds: cycleNodes });

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * Returns one cycle's node ids (in traversal order) if any cycle is
 * present, else `null`. Used both by `validateDag` and as a debug aid.
 */
function detectCycles(def: WorkflowDef): string[] | null {
  const adj = new Map<string, string[]>();
  for (const n of def.nodes) adj.set(n.id, []);
  for (const e of def.edges) {
    const list = adj.get(e.from);
    if (list) list.push(e.to);
  }
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();
  for (const n of def.nodes) colour.set(n.id, WHITE);

  const stack: string[] = [];
  function dfs(u: string): string[] | null {
    colour.set(u, GRAY);
    stack.push(u);
    for (const v of adj.get(u) ?? []) {
      const c = colour.get(v) ?? WHITE;
      if (c === WHITE) {
        const cycle = dfs(v);
        if (cycle) return cycle;
      } else if (c === GRAY) {
        // Back-edge → cycle. Slice the stack from `v` to the current top.
        const i = stack.indexOf(v);
        return stack.slice(i).concat(v);
      }
    }
    stack.pop();
    colour.set(u, BLACK);
    return null;
  }

  for (const n of def.nodes) {
    if ((colour.get(n.id) ?? WHITE) === WHITE) {
      const cycle = dfs(n.id);
      if (cycle) return cycle;
    }
  }
  return null;
}

/**
 * Group nodes into levels of identical topological depth.
 *
 * Pre:  `def` is acyclic (otherwise this throws).
 * Post: returns `NodeDef[][]` such that every edge `(u, v)` satisfies
 *       `level(u) < level(v)`. The executor can `Promise.all` each
 *       inner list to run that level in parallel.
 *
 * Implementation: Kahn's algorithm with batched indegree=0 collection.
 */
export function topoLevels(def: WorkflowDef): NodeDef[][] {
  const byId = new Map<string, NodeDef>();
  for (const n of def.nodes) byId.set(n.id, n);

  const inDeg = new Map<string, number>();
  for (const n of def.nodes) inDeg.set(n.id, 0);
  for (const e of def.edges) inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);

  const out = new Map<string, string[]>();
  for (const n of def.nodes) out.set(n.id, []);
  for (const e of def.edges) out.get(e.from)?.push(e.to);

  const levels: NodeDef[][] = [];
  let current: NodeDef[] = [];
  for (const n of def.nodes) if ((inDeg.get(n.id) ?? 0) === 0) current.push(n);

  let placed = 0;
  while (current.length > 0) {
    levels.push(current);
    placed += current.length;
    const next: NodeDef[] = [];
    for (const n of current) {
      for (const v of out.get(n.id) ?? []) {
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

  if (placed < def.nodes.length) {
    throw new Error("cycle detected");
  }
  return levels;
}
