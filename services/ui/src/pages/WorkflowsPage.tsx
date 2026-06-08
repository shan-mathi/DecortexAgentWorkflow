import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type WorkflowMeta } from "../api.js";


export function WorkflowsPage() {
  const [items, setItems] = useState<WorkflowMeta[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.listWorkflows().then(setItems).catch((e: Error) => setErr(e.message)); }, []);

  if (err) return <div className="text-red-700">Error: {err}</div>;
  if (!items) return <div className="text-slate-500">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Workflows</h1>
        <Link to="/workflows/new" className="px-3 py-1.5 bg-slate-900 text-white rounded text-sm">
          Create Workflow
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="text-slate-500">No workflows yet.</p>
      ) : (
        <table className="w-full bg-white border border-slate-200 rounded text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2 w-20">Version</th>
              <th className="px-3 py-2 w-48">ID</th>
              <th className="px-3 py-2 w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((w) => (
              <tr key={w.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2">
                  <Link to={`/workflows/${w.id}`} className="text-blue-700 hover:underline">{w.name}</Link>
                </td>
                <td className="px-3 py-2 tabular-nums">v{w.version}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{w.id}</td>
                <td className="px-3 py-2 flex gap-2">
                  <Link to={`/workflows/${w.id}/execute`} className="text-blue-700 text-xs hover:underline">Run</Link>
                  <button
                    onClick={async () => {
                      if (!confirm(`Delete workflow "${w.name}"?`)) return;
                      try {
                        await api.deleteWorkflow(w.id);
                        setItems(items!.filter((x) => x.id !== w.id));
                      } catch { alert("Failed to delete."); }
                    }}
                    className="text-red-600 text-xs hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
