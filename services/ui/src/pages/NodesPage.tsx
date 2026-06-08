import { useEffect, useState } from "react";
import { api, type NodeType, type RegisteredNode } from "../api.js";

export function NodesPage() {
  const [types, setTypes] = useState<NodeType[]>([]);
  const [nodes, setNodes] = useState<RegisteredNode[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    Promise.all([api.listNodeTypes(), api.listNodes()])
      .then(([t, n]) => { setTypes(t); setNodes(n); })
      .catch((e: Error) => setErr(e.message));
  }, []);

  if (err) return <div className="text-red-700">Error: {err}</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Nodes</h1>
        <button onClick={() => setShowForm(!showForm)} className="px-3 py-1.5 bg-slate-900 text-white rounded text-sm">
          {showForm ? "Cancel" : "Register Node"}
        </button>
      </div>

      {showForm && <RegisterNodeForm types={types} onCreated={(n) => { setNodes([n, ...nodes]); setShowForm(false); }} />}

      <div className="grid grid-cols-2 gap-4 mt-4">
        <div>
          <h2 className="font-semibold text-sm text-slate-600 mb-2">Node Types (templates)</h2>
          <div className="space-y-2">
            {types.map((t) => (
              <div key={t.id} className="bg-white border border-slate-200 rounded p-3">
                <div className="font-medium text-sm">{t.name}</div>
                <div className="text-xs text-slate-500">{t.category} · {t.description ?? "No description"}</div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h2 className="font-semibold text-sm text-slate-600 mb-2">Registered Nodes ({nodes.length})</h2>
          <div className="space-y-2">
            {nodes.map((n) => (
              <NodeCard key={n.id} node={n} onDeleted={() => setNodes(nodes.filter((x) => x.id !== n.id))} />
            ))}
            {nodes.length === 0 && <p className="text-slate-500 text-sm">No nodes registered yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

const EXAMPLE_CONFIGS: Record<string, string> = {
  llm: JSON.stringify({
    promptTemplate: "Classify the urgency of this ticket as LOW, MED, or HIGH. Reply with only the label.\n\nSubject: {{input.subject}}\nBody: {{input.body}}",
    model: "anthropic.claude-3-haiku-20240307-v1:0",
    maxTokens: 100,
  }, null, 2),
  http: JSON.stringify({
    method: "GET",
    url: "https://api.example.com/tickets/{{input.id}}",
    headers: { "Authorization": "Bearer {{input.token}}" },
  }, null, 2),
  branch: JSON.stringify({
    expression: "upper(nodes.classify.text)",
    branches: { "HIGH": "urgent-reply", "MED": "urgent-reply", "LOW": "generic-ack" },
    default: "generic-ack",
  }, null, 2),
  transform: JSON.stringify({
    expression: "upper(nodes.classify.text)",
  }, null, 2),
};

function RegisterNodeForm({ types, onCreated }: { types: NodeType[]; onCreated: (n: RegisteredNode) => void }) {
  const [name, setName] = useState("");
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [config, setConfig] = useState(EXAMPLE_CONFIGS[types[0]?.category ?? "llm"] ?? "{}");
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedType = types.find((t) => t.id === typeId);

  const onTypeChange = (newTypeId: string) => {
    setTypeId(newTypeId);
    const t = types.find((x) => x.id === newTypeId);
    if (t && EXAMPLE_CONFIGS[t.category]) {
      setConfig(EXAMPLE_CONFIGS[t.category]!);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      const parsed = JSON.parse(config) as unknown;
      const n = await api.registerNode({
        name,
        nodeTypeId: typeId,
        category: selectedType?.category ?? "llm",
        config: parsed,
      });
      onCreated(n);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded p-4 mb-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-slate-600">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="block w-full border border-slate-300 rounded px-2 py-1 text-sm mt-1" placeholder="classify-ticket" />
        </label>
        <label className="block">
          <span className="text-xs text-slate-600">Node Type</span>
          <select value={typeId} onChange={(e) => onTypeChange(e.target.value)} className="block w-full border border-slate-300 rounded px-2 py-1 text-sm mt-1">
            {types.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.category})</option>)}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="text-xs text-slate-600">Config (JSON) — example pre-filled for {selectedType?.category ?? "llm"} type</span>
        <textarea value={config} onChange={(e) => setConfig(e.target.value)} rows={8} className="block w-full border border-slate-300 rounded px-2 py-1 text-xs font-mono mt-1" />
      </label>
      {err && <p className="text-xs text-red-700">{err}</p>}
      <button onClick={submit} disabled={submitting || !name} className="px-3 py-1.5 bg-blue-700 text-white rounded text-sm disabled:opacity-50">
        {submitting ? "Registering..." : "Register"}
      </button>
    </div>
  );
}

function NodeCard({ node, onDeleted }: { node: RegisteredNode; onDeleted: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Delete node "${node.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api.deleteNode(node.id);
      onDeleted();
    } catch {
      alert("Failed to delete node. It may be in use by a workflow.");
      setDeleting(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium text-sm">{node.name}</div>
          <div className="text-xs text-slate-500">{node.category} · {node.id.slice(0, 8)}...</div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setExpanded(!expanded)} className="text-xs text-blue-700 hover:underline">
            {expanded ? "Hide" : "Config"}
          </button>
          <button onClick={handleDelete} disabled={deleting} className="text-xs text-red-600 hover:underline disabled:opacity-50">
            {deleting ? "..." : "Delete"}
          </button>
        </div>
      </div>
      {expanded && (
        <pre className="mt-2 bg-slate-50 border border-slate-200 rounded p-2 text-xs font-mono overflow-auto max-h-48">
          {JSON.stringify(node.config, null, 2)}
        </pre>
      )}
    </div>
  );
}
