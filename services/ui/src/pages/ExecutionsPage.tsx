import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type RunSummary } from "../api.js";
import { StatusBadge } from "../components/StatusBadge.js";

export function ExecutionsPage() {
  const [params] = useSearchParams();
  const workflowId = params.get("workflowId") ?? undefined;
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.listExecutions(workflowId).then(setRuns).catch((e: Error) => setErr(e.message));
  }, [workflowId]);

  if (err) return <div className="text-red-700">Error: {err}</div>;
  if (!runs) return <div className="text-slate-500">Loading...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Executions</h1>
      {runs.length === 0 ? (
        <p className="text-slate-500">No executions yet.</p>
      ) : (
        <table className="w-full bg-white border border-slate-200 rounded text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-3 py-2">Run ID</th>
              <th className="px-3 py-2 w-28">Status</th>
              <th className="px-3 py-2 w-40">Started</th>
              <th className="px-3 py-2 w-32">Duration</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const dur = r.endedAt
                ? `${new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()} ms`
                : "—";
              return (
                <tr key={r.runId} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <Link to={`/executions/${r.runId}`} className="text-blue-700 hover:underline font-mono text-xs">
                      {r.runId}
                    </Link>
                  </td>
                  <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                  <td className="px-3 py-2">{new Date(r.startedAt).toLocaleString()}</td>
                  <td className="px-3 py-2 tabular-nums">{dur}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
