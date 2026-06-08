import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import { api, type RegisteredNode, type WorkflowFull } from "../api.js";

interface WfNode {
  nodeId: string;
  registeredNodeId: string;
  name: string | null;
  configOverride: unknown;
  positionX: number;
  positionY: number;
}

export function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [wf, setWf] = useState<WorkflowFull | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"graph" | "json">("graph");
  const [selected, setSelected] = useState<WfNode | null>(null);
  const [regNodes, setRegNodes] = useState<Map<string, RegisteredNode>>(new Map());
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.getWorkflow(id).then(setWf).catch((e: Error) => setErr(e.message));
    api.listNodes().then((nodes) => {
      setRegNodes(new Map(nodes.map((n) => [n.id, n])));
    }).catch(() => {});
  }, [id]);

  const { nodes, edges } = useMemo(() => {
    if (!wf) return { nodes: [], edges: [] };
    const ns: Node[] = wf.nodes.map((n) => ({
      id: n.nodeId,
      position: { x: n.positionX, y: n.positionY },
      data: { label: `${n.name ?? n.nodeId}` },
      style: {
        padding: 8,
        fontSize: 12,
        border: selected?.nodeId === n.nodeId ? "2px solid #2563eb" : "1px solid #cbd5e1",
        borderRadius: 4,
        background: selected?.nodeId === n.nodeId ? "#eff6ff" : "#fff",
        minWidth: 140,
        cursor: "pointer",
      },
    }));
    const es: Edge[] = wf.edges.map((e, i) => ({
      id: `e-${i}`,
      source: e.from,
      target: e.to,
      label: e.conditionExpression ?? undefined,
      style: { stroke: "#94a3b8" },
    }));
    return { nodes: ns, edges: es };
  }, [wf, selected]);

  const handleNodeClick = (_: unknown, node: { id: string }) => {
    const wfNode = wf?.nodes.find((n) => n.nodeId === node.id);
    setSelected(wfNode ?? null);
  };

  const updateNodeConfig = (nodeId: string, newConfig: unknown) => {
    if (!wf) return;
    const updated = {
      ...wf,
      nodes: wf.nodes.map((n) =>
        n.nodeId === nodeId ? { ...n, configOverride: newConfig } : n,
      ),
    };
    setWf(updated);
    setSelected(updated.nodes.find((n) => n.nodeId === nodeId) ?? null);
  };

  const updateNodeName = (nodeId: string, newName: string) => {
    if (!wf) return;
    const updated = {
      ...wf,
      nodes: wf.nodes.map((n) =>
        n.nodeId === nodeId ? { ...n, name: newName || null } : n,
      ),
    };
    setWf(updated);
    setSelected(updated.nodes.find((n) => n.nodeId === nodeId) ?? null);
  };

  const saveWorkflow = async () => {
    if (!wf || !id) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const body = {
        name: wf.name,
        description: wf.description ?? undefined,
        nodes: wf.nodes.map((n) => ({
          nodeId: n.nodeId,
          registeredNodeId: n.registeredNodeId,
          name: n.name ?? undefined,
          configOverride: n.configOverride,
          positionX: n.positionX,
          positionY: n.positionY,
        })),
        edges: wf.edges.map((e) => ({
          from: e.from,
          to: e.to,
          conditionExpression: e.conditionExpression,
        })),
      };
      const result = await api.updateWorkflow(id, body);
      setWf({ ...wf, version: result.version });
      setSaveMsg(`Saved! v${result.version}`);
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (e) {
      setSaveMsg(`Error: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  if (err) return <div className="text-red-700">Error: {err}</div>;
  if (!wf) return <div className="text-slate-500">Loading...</div>;

  const selectedReg = selected ? regNodes.get(selected.registeredNodeId) : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">{wf.name}</h1>
          <p className="text-sm text-slate-500">v{wf.version} · {wf.nodes.length} nodes · {wf.edges.length} edges</p>
        </div>
        <div className="flex gap-2 items-center">
          {saveMsg && <span className="text-sm text-green-700">{saveMsg}</span>}
          <button onClick={saveWorkflow} disabled={saving} className="px-3 py-1.5 bg-blue-700 text-white rounded text-sm disabled:opacity-50">
            {saving ? "Saving..." : "Save Changes"}
          </button>
          <Link to={`/executions?workflowId=${wf.id}`} className="px-3 py-1.5 border border-slate-300 rounded text-sm">
            Runs
          </Link>
          <Link to={`/workflows/${wf.id}/execute`} className="px-3 py-1.5 bg-slate-900 text-white rounded text-sm">
            Execute
          </Link>
        </div>
      </div>

      <div className="flex gap-2 mb-3">
        <button onClick={() => setTab("graph")} className={`px-3 py-1 rounded text-sm ${tab === "graph" ? "bg-slate-900 text-white" : "border border-slate-300"}`}>Graph</button>
        <button onClick={() => setTab("json")} className={`px-3 py-1 rounded text-sm ${tab === "json" ? "bg-slate-900 text-white" : "border border-slate-300"}`}>JSON</button>
      </div>

      {tab === "graph" ? (
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <div className="w-full h-[500px] bg-white border border-slate-200 rounded">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                fitView
                nodesDraggable={false}
                nodesConnectable={false}
                onNodeClick={handleNodeClick}
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={16} size={1} color="#e2e8f0" />
                <Controls showInteractive={false} />
              </ReactFlow>
            </div>
          </div>

          <aside className="col-span-1">
            {selected ? (
              <NodePanel
                node={selected}
                registeredNode={selectedReg}
                onUpdateConfig={(cfg) => updateNodeConfig(selected.nodeId, cfg)}
                onUpdateName={(name) => updateNodeName(selected.nodeId, name)}
              />
            ) : (
              <div className="bg-white border border-dashed border-slate-300 rounded p-4 text-center text-sm text-slate-500">
                Click a node in the graph to view and edit its configuration.
              </div>
            )}
          </aside>
        </div>
      ) : (
        <pre className="bg-white border border-slate-200 rounded p-4 text-xs overflow-auto max-h-[600px]">
          {JSON.stringify(wf, null, 2)}
        </pre>
      )}
    </div>
  );
}

function NodePanel({
  node,
  registeredNode,
  onUpdateConfig,
  onUpdateName,
}: {
  node: WfNode;
  registeredNode: RegisteredNode | null | undefined;
  onUpdateConfig: (cfg: unknown) => void;
  onUpdateName: (name: string) => void;
}) {
  const [configText, setConfigText] = useState(
    JSON.stringify(node.configOverride ?? {}, null, 2),
  );
  const [configErr, setConfigErr] = useState<string | null>(null);

  // Re-sync when a different node is selected
  useEffect(() => {
    setConfigText(JSON.stringify(node.configOverride ?? {}, null, 2));
    setConfigErr(null);
  }, [node.nodeId, node.configOverride]);

  const applyConfig = () => {
    try {
      const parsed = JSON.parse(configText);
      onUpdateConfig(parsed);
      setConfigErr(null);
    } catch (e) {
      setConfigErr((e as Error).message);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded p-3 space-y-3">
      <h2 className="font-bold text-sm">Node: {node.nodeId}</h2>

      <div className="space-y-2 text-sm">
        <div>
          <span className="text-xs text-slate-500">Registered Node</span>
          <div className="font-mono text-xs">{registeredNode?.name ?? node.registeredNodeId.slice(0, 8) + "..."}</div>
        </div>

        {registeredNode && (
          <div>
            <span className="text-xs text-slate-500">Type</span>
            <div className="text-xs">
              <span className="bg-slate-100 px-1.5 py-0.5 rounded">{registeredNode.category}</span>
            </div>
          </div>
        )}

        {registeredNode && (
          <div>
            <span className="text-xs text-slate-500">Base Config (from registered node)</span>
            <pre className="bg-slate-50 border border-slate-200 rounded p-2 text-xs font-mono overflow-auto max-h-32 mt-1">
              {JSON.stringify(registeredNode.config, null, 2)}
            </pre>
          </div>
        )}

        <label className="block">
          <span className="text-xs text-slate-500">Display Name</span>
          <input
            value={node.name ?? ""}
            onChange={(e) => onUpdateName(e.target.value)}
            className="block w-full border border-slate-300 rounded px-2 py-1 text-sm mt-1"
            placeholder={node.nodeId}
          />
        </label>

        <div>
          <span className="text-xs text-slate-500">Config Override (merged on top of base config at execution)</span>
          <textarea
            value={configText}
            onChange={(e) => setConfigText(e.target.value)}
            rows={8}
            className="block w-full border border-slate-300 rounded px-2 py-1 text-xs font-mono mt-1"
          />
          {configErr && <p className="text-xs text-red-700 mt-1">{configErr}</p>}
          <button onClick={applyConfig} className="mt-2 px-3 py-1 bg-blue-700 text-white rounded text-xs">
            Apply Config
          </button>
        </div>
      </div>
    </div>
  );
}
