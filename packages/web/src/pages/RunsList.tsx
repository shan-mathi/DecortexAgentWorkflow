// Per-workflow runs list. Status badge + duration. Click navigates
// to the trace page.

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import type { RunSummary } from "@workflow-engine/shared";

import { api } from "../api.js";
import { Error, Loading } from "./WorkflowsList.js";

export function RunsList() {
  const { id } = useParams<{ id: string }>();
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.listRuns(id).then(setRuns).catch((e: Error) => setErr(e.message));
  }, [id]);

  if (err) return <Error message={err} />;
  if (!runs) return <Loading />;

  if (runs.length === 0) {
    return (
      <div className="text-slate-500 py-12 text-center">
        No runs yet. Trigger one from the workflow page.
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Runs</h1>
      <table className="w-full border border-slate-200 bg-white rounded">
        <thead className="bg-slate-100 text-left text-sm text-slate-600">
          <tr>
            <th className="px-3 py-2">Run</th>
            <th className="px-3 py-2 w-32">Status</th>
            <th className="px-3 py-2 w-40">Started</th>
            <th className="px-3 py-2 w-32">Duration</th>
          </tr>
        </thead>
        <tbody className="text-sm">
          {runs.map((r) => {
            const dur =
              r.endedAt && r.startedAt
                ? `${Math.round((new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()))} ms`
                : "—";
            return (
              <tr key={r.runId} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2">
                  <Link to={`/runs/${r.runId}`} className="text-blue-700 hover:underline font-mono text-xs">
                    {r.runId}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-3 py-2">{new Date(r.startedAt).toLocaleString()}</td>
                <td className="px-3 py-2 tabular-nums">{dur}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "SUCCEEDED"
      ? "bg-green-100 text-green-800"
      : status === "FAILED"
        ? "bg-red-100 text-red-800"
        : status === "RUNNING"
          ? "bg-blue-100 text-blue-800"
          : "bg-slate-100 text-slate-700";
  return <span className={`px-2 py-0.5 rounded text-xs ${cls}`}>{status}</span>;
}
