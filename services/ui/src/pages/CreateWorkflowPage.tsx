import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type RegisteredNode } from "../api.js";

interface WfNode {
  key: string;
  nodeId: string;
  registeredNodeId: string;
  name: string;
}

interface WfEdge {
  from: string;
  to: string;
}

export function CreateWorkflowPage() {
  const navigate = useNavigate();
  const [allNodes, setAllNodes] = useState<RegisteredNode[]>([]);
  const [wfName, setWfName] = useState("");
  const [picked, setPicked] = useState<WfNode[]>([]);
  const [edges, setEdges] = useState<WfEdge[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.listNodes().then(setAllNodes).catch(() => {}); }, []);

  const addNode = (n: RegisteredNode) => {
    const base = n.name.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
    const existing = picked.filter((p) => p.registeredNodeId === n.id).length;
    const nodeId = existing > 0 ? `${base}-${existing + 1}` : base;
    setPicked([...picked, { key: `${n.id}-${Date.now()}`, nodeId, registeredNodeId: n.id, name: n.name }]);
  };

  const removeNode = (key: string) => {
    const node = picked.find((p) => p.key === key);
    setPicked(picked.filter((p) => p.key !== key));
    if (node) setEdges(edges.filter((e) => e.from !== node.nodeId && e.to !== node.nodeId));
  };

  const addEdge = (from: string, to: string) => {
    if (from && to && from !== to) setEdges([...edges, { from, to }]);
  };

  const submit = async () => {
    setErr(null);
    try {
      const body = {
        name: wfName,
        nodes: picked.map((p, i) => ({
          nodeId: p.nodeId,
          registeredNodeId: p.registeredNodeId,
          name: p.name,
          positionX: i * 220,
          positionY: 0,
        })),
        edges,
      };
      const meta = await api.createWorkflow(body);
      navigate(`/workflows/${meta.id}`);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Create Workflow</h1>

      <label className="block mb-4">
        <span className="text-sm text-slate-600">Workflow Name</span>
        <input value={wfName} onChange={(e) => setWfName(e.target.value)} className="block w-full border border-slate-300 rounded px-2 py-1 mt-1" placeholder="ops-ticket-router" />
      </label>

      <div className="grid grid-cols-3 gap-4">
        {/* Palette */}
        <div>
          <h2 className="font-semibold text-sm text-slate-600 mb-2">Available Nodes</h2>
          <div className="space-y-1">
            {allNodes.map((n) => (
              <button key={n.id} onClick={() => addNode(n)} className="w-full text-left bg-white border border-slate-200 rounded p-2 hover:border-blue-400 text-sm">
                <span className="font-medium">{n.name}</span>
                <span className="text-xs text-slate-500 ml-2">{n.category}</span>
              </button>
            ))}
            {allNodes.length === 0 && <p className="text-sm text-slate-500">Register nodes first.</p>}
          </div>
        </div>

        {/* Selected nodes + edges */}
        <div className="col-span-2">
          <h2 className="font-semibold text-sm text-slate-600 mb-2">Workflow Nodes (execution order top → bottom)</h2>
          <div className="space-y-2 mb-4">
            {picked.map((p, i) => (
              <div key={p.key} className="flex items-center gap-2 bg-white border border-slate-200 rounded p-2">
                <span className="text-xs text-slate-400">#{i + 1}</span>
                <span className="text-sm font-medium flex-1">{p.name}</span>
                <input value={p.nodeId} onChange={(e) => {
                  const updated = [...picked];
                  updated[i] = { ...p, nodeId: e.target.value };
                  setPicked(updated);
                }} className="border border-slate-300 rounded px-1 text-xs font-mono w-36" />
                <button onClick={() => removeNode(p.key)} className="text-red-600 text-xs">Remove</button>
              </div>
            ))}
            {picked.length === 0 && <p className="text-sm text-slate-400">Click nodes from the palette to add them.</p>}
          </div>

          <h2 className="font-semibold text-sm text-slate-600 mb-2">Edges</h2>
          <div className="space-y-1 mb-3">
            {edges.map((e, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="font-mono text-xs">{e.from} → {e.to}</span>
                <button onClick={() => setEdges(edges.filter((_, j) => j !== i))} className="text-red-600 text-xs">x</button>
              </div>
            ))}
          </div>
          <AddEdgeForm picked={picked} onAdd={addEdge} />

          {err && <p className="text-sm text-red-700 mt-3">{err}</p>}
          <button onClick={submit} disabled={!wfName || picked.length === 0} className="mt-4 px-4 py-2 bg-slate-900 text-white rounded text-sm disabled:opacity-50">
            Save Workflow
          </button>
        </div>
      </div>
    </div>
  );
}

function AddEdgeForm({ picked, onAdd }: { picked: WfNode[]; onAdd: (from: string, to: string) => void }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  return (
    <div className="flex gap-2 items-center">
      <select value={from} onChange={(e) => setFrom(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs">
        <option value="">From...</option>
        {picked.map((p) => <option key={p.key} value={p.nodeId}>{p.nodeId}</option>)}
      </select>
      <span className="text-slate-400">→</span>
      <select value={to} onChange={(e) => setTo(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs">
        <option value="">To...</option>
        {picked.map((p) => <option key={p.key} value={p.nodeId}>{p.nodeId}</option>)}
      </select>
      <button onClick={() => { onAdd(from, to); setFrom(""); setTo(""); }} disabled={!from || !to} className="px-2 py-1 bg-blue-700 text-white rounded text-xs disabled:opacity-50">
        Add Edge
      </button>
    </div>
  );
}
