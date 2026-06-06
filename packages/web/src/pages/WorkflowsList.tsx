// Workflows list page. Single GET /workflows; click navigates to
// detail. Empty-state nudges towards the editor.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { api, type WorkflowMeta } from "../api.js";

export function WorkflowsList() {
  const [items, setItems] = useState<WorkflowMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listWorkflows().then(setItems).catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <Error message={error} />;
  if (!items) return <Loading />;

  if (items.length === 0) {
    return (
      <div className="text-center py-16 text-slate-500">
        <p className="mb-3">No workflows yet.</p>
        <Link
          to="/new"
          className="inline-block px-4 py-2 bg-slate-900 text-white rounded text-sm"
        >
          Create one
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Workflows</h1>
        <Link
          to="/new"
          className="px-3 py-1.5 bg-slate-900 text-white rounded text-sm"
        >
          New workflow
        </Link>
      </div>
      <table className="w-full border border-slate-200 bg-white rounded">
        <thead className="bg-slate-100 text-left text-sm text-slate-600">
          <tr>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2 w-32">Version</th>
            <th className="px-3 py-2 w-64">ID</th>
          </tr>
        </thead>
        <tbody className="text-sm">
          {items.map((w) => (
            <tr key={w.id} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="px-3 py-2">
                <Link to={`/workflows/${w.id}`} className="text-blue-700 hover:underline">
                  {w.name}
                </Link>
              </td>
              <td className="px-3 py-2 tabular-nums">{w.version}</td>
              <td className="px-3 py-2 font-mono text-xs text-slate-500">{w.id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Loading() {
  return <div className="text-slate-500">Loading…</div>;
}
export function Error({ message }: { message: string }) {
  return <div className="text-red-700">Error: {message}</div>;
}
