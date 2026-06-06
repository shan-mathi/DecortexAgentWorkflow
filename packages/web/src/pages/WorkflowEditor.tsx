// Selection-order workflow editor.
//
// UX (per design):
//   1. Pick nodes from a palette one at a time.
//   2. Each pick gets an auto-generated config form (driven by the
//      node's `configSchema` — the same schema the executor uses).
//   3. Selection order defines execution order; the synthesised
//      WorkflowDef has linear edges `nodes[i] → nodes[i+1]`.
//   4. Branch nodes get an inline routing form: for each `caseLabel`
//      defined on the Branch's config, the user picks a target from
//      already-added downstream nodes. The linear-next edge from the
//      Branch is dropped; one edge per case is synthesised instead.
//   5. A "JSON view" toggle renders the synthesised WorkflowDef
//      exactly as the editor would POST.
//
// What this editor does NOT support (deliberate V1 cuts):
//   - Diamond DAGs and multi-Branch series — engine handles them, but
//     the form-stacking UX gets confusing. Power users use the JSON
//     editor below.
//   - Free-form drag-and-drop edge drawing — listed in DESIGN.md
//     under "things to build next".

import Form from "@rjsf/core";
import validator from "@rjsf/validator-ajv8";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { EdgeDef, NodeDef, WorkflowDef } from "@workflow-engine/shared";

import { api } from "../api.js";
import { useNodeTypes } from "../nodeTypes.js";

interface Picked {
  /** stable instance id within the editor (not the persisted UUID) */
  key: string;
  /** node executor type, e.g. "llm" */
  type: string;
  /** the workflow-def-level node id ("classify", "branch", ...) */
  id: string;
  /** display name (optional) */
  name?: string;
  /** node's typed config */
  config: Record<string, unknown>;
  /** Branch routing: caseLabel → target node id (only for branch) */
  routes?: Record<string, string>;
}

export function WorkflowEditor() {
  const navigate = useNavigate();
  const { list, byType, loading } = useNodeTypes();
  const [name, setName] = useState("my-workflow");
  const [picked, setPicked] = useState<Picked[]>([]);
  const [view, setView] = useState<"editor" | "json">("editor");
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const def = useMemo(() => synthesiseDef(name, picked), [name, picked]);

  const addPick = (type: string) => {
    const idx = picked.filter((p) => p.type === type).length;
    const id = idx === 0 ? type : `${type}_${idx + 1}`;
    setPicked([
      ...picked,
      {
        key: `${type}-${Date.now()}`,
        type,
        id,
        config: {},
        routes: type === "branch" ? {} : undefined,
      },
    ]);
  };

  const updatePicked = (key: string, patch: Partial<Picked>) => {
    setPicked((cur) =>
      cur.map((p) => (p.key === key ? { ...p, ...patch } : p)),
    );
  };

  const removePicked = (key: string) => {
    setPicked((cur) => cur.filter((p) => p.key !== key));
  };

  const movePicked = (key: string, dir: -1 | 1) => {
    setPicked((cur) => {
      const i = cur.findIndex((p) => p.key === key);
      if (i < 0) return cur;
      const j = i + dir;
      if (j < 0 || j >= cur.length) return cur;
      const copy = cur.slice();
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      return copy;
    });
  };

  const submit = async () => {
    setSubmitErr(null);
    try {
      const meta = await api.createWorkflow(def);
      navigate(`/workflows/${meta.id}`);
    } catch (e) {
      setSubmitErr((e as Error).message);
    }
  };

  if (loading) return <div className="text-slate-500">Loading node types…</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">New workflow</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setView(view === "editor" ? "json" : "editor")}
            className="px-3 py-1.5 border border-slate-300 rounded text-sm bg-white"
          >
            {view === "editor" ? "View JSON" : "Back to editor"}
          </button>
          <button
            onClick={submit}
            disabled={picked.length === 0}
            className="px-3 py-1.5 bg-slate-900 text-white rounded text-sm disabled:opacity-50"
          >
            Save workflow
          </button>
        </div>
      </div>

      <label className="block mb-4">
        <span className="text-sm text-slate-600">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="block w-full border border-slate-300 rounded px-2 py-1 mt-1"
        />
      </label>

      {submitErr && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded mb-3">
          {submitErr}
        </div>
      )}

      {view === "json" ? (
        <pre className="bg-white border border-slate-200 rounded p-4 text-xs overflow-auto">
          {JSON.stringify(def, null, 2)}
        </pre>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          <aside className="col-span-1">
            <h2 className="font-semibold mb-2 text-sm">Palette</h2>
            <div className="space-y-2">
              {list.map((nt) => (
                <button
                  key={nt.type}
                  onClick={() => addPick(nt.type)}
                  className="w-full text-left bg-white border border-slate-200 rounded p-2 hover:border-slate-400"
                >
                  <div className="font-medium text-sm">{nt.displayName}</div>
                  <div className="text-xs text-slate-500">{nt.description}</div>
                </button>
              ))}
            </div>
          </aside>

          <div className="col-span-2 space-y-3">
            {picked.length === 0 && (
              <div className="text-slate-500 text-sm bg-white border border-dashed border-slate-300 rounded p-6 text-center">
                Pick a node type from the palette to start building.
              </div>
            )}
            {picked.map((p, idx) => {
              const nt = byType[p.type];
              if (!nt) return null;
              return (
                <div key={p.key} className="bg-white border border-slate-200 rounded p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm">
                      <span className="text-slate-500 mr-2">#{idx + 1}</span>
                      <span className="font-medium">{nt.displayName}</span>
                    </div>
                    <div className="flex gap-1 text-xs">
                      <button
                        onClick={() => movePicked(p.key, -1)}
                        disabled={idx === 0}
                        className="px-2 py-0.5 border border-slate-300 rounded disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => movePicked(p.key, 1)}
                        disabled={idx === picked.length - 1}
                        className="px-2 py-0.5 border border-slate-300 rounded disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => removePicked(p.key)}
                        className="px-2 py-0.5 border border-red-300 text-red-700 rounded"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <label className="block mb-2">
                    <span className="text-xs text-slate-500">Node id</span>
                    <input
                      value={p.id}
                      onChange={(e) => updatePicked(p.key, { id: e.target.value })}
                      className="block border border-slate-300 rounded px-2 py-1 text-sm font-mono"
                    />
                  </label>

                  <Form
                    schema={nt.configSchema as object}
                    formData={p.config}
                    validator={validator}
                    onChange={(e) =>
                      updatePicked(p.key, { config: e.formData as Record<string, unknown> })
                    }
                    uiSchema={{ "ui:submitButtonOptions": { norender: true } }}
                  />

                  {p.type === "branch" && (
                    <BranchRoutingForm
                      picked={p}
                      allPicked={picked}
                      onChange={(routes) => updatePicked(p.key, { routes })}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function BranchRoutingForm({
  picked,
  allPicked,
  onChange,
}: {
  picked: Picked;
  allPicked: Picked[];
  onChange: (routes: Record<string, string>) => void;
}) {
  const cfg = picked.config as { branches?: Record<string, string> };
  const cases = Object.keys(cfg.branches ?? {});
  const downstream = allPicked.slice(allPicked.findIndex((p) => p.key === picked.key) + 1);

  if (cases.length === 0) {
    return (
      <p className="mt-2 text-xs text-slate-500">
        Define cases via the <code>branches</code> field, then map each to a downstream node.
      </p>
    );
  }

  return (
    <div className="mt-2 border-t border-slate-100 pt-2">
      <h3 className="text-xs font-semibold mb-1 text-slate-600">Branch routing</h3>
      {cases.map((c) => (
        <div key={c} className="flex items-center gap-2 mb-1">
          <span className="font-mono text-xs w-20 text-slate-700">{c}</span>
          <span className="text-slate-400">→</span>
          <select
            value={picked.routes?.[c] ?? cfg.branches?.[c] ?? ""}
            onChange={(e) => onChange({ ...(picked.routes ?? {}), [c]: e.target.value })}
            className="flex-1 border border-slate-300 rounded px-2 py-1 text-sm"
          >
            <option value="">Pick a target</option>
            {downstream.map((d) => (
              <option key={d.key} value={d.id}>
                {d.id} ({d.type})
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

/**
 * Synthesise a WorkflowDef from the editor's selection-order state.
 *
 * - Nodes inherit position from their order index (left→right layout).
 * - Edges: linear `nodes[i] → nodes[i+1]` for non-branch nodes.
 * - For each branch, the linear-next edge is dropped; one edge per
 *   `routes[case]` is synthesised instead.
 */
function synthesiseDef(name: string, picked: Picked[]): WorkflowDef {
  const nodes: NodeDef[] = picked.map((p, i) => ({
    id: p.id,
    type: p.type,
    name: p.name,
    config: p.type === "branch" && p.routes
      ? { ...p.config, branches: p.routes }
      : p.config,
    position_x: i * 220,
    position_y: 0,
  }));

  const edges: EdgeDef[] = [];
  for (let i = 0; i < picked.length; i++) {
    const p = picked[i]!;
    if (p.type === "branch" && p.routes) {
      const targets = new Set(Object.values(p.routes));
      for (const target of targets) {
        if (target) edges.push({ from: p.id, to: target });
      }
    } else if (i < picked.length - 1) {
      // Linear edge to the next non-branch-skipped node.
      const next = picked[i + 1]!;
      edges.push({ from: p.id, to: next.id });
    }
  }

  return { name: name.trim() || "untitled", nodes, edges };
}
