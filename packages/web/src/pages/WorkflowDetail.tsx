// Workflow detail: read-only React Flow graph + JSON tab + Trigger
// Run modal that posts a JSON input to /workflows/:id/runs.

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import type { WorkflowDef } from "@workflow-engine/shared";

import { api } from "../api.js";
import { Graph } from "../Graph.js";
import { Error, Loading } from "./WorkflowsList.js";

export function WorkflowDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [def, setDef] = useState<WorkflowDef | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"graph" | "json">("graph");
  const [showRun, setShowRun] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.getWorkflow(id).then(setDef).catch((e: Error) => setError(e.message));
  }, [id]);

  if (error) return <Error message={error} />;
  if (!def || !id) return <Loading />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold">{def.name}</h1>
          <p className="text-sm text-slate-500">
            v{def.version} · {def.nodes.length} nodes · {def.edges.length} edges
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to={`/workflows/${id}/runs`}
            className="px-3 py-1.5 border border-slate-300 rounded text-sm"
          >
            Runs
          </Link>
          <button
            onClick={() => setShowRun(true)}
            className="px-3 py-1.5 bg-slate-900 text-white rounded text-sm"
          >
            Trigger run
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-3 text-sm">
        <button
          onClick={() => setTab("graph")}
          className={`px-3 py-1.5 rounded ${tab === "graph" ? "bg-slate-900 text-white" : "bg-white border border-slate-300"}`}
        >
          Graph
        </button>
        <button
          onClick={() => setTab("json")}
          className={`px-3 py-1.5 rounded ${tab === "json" ? "bg-slate-900 text-white" : "bg-white border border-slate-300"}`}
        >
          JSON
        </button>
      </div>

      {tab === "graph" ? (
        <Graph def={def} />
      ) : (
        <pre className="bg-white border border-slate-200 rounded p-4 text-xs overflow-auto">
          {JSON.stringify(def, null, 2)}
        </pre>
      )}

      {showRun && (
        <RunModal
          workflowId={id}
          onClose={() => setShowRun(false)}
          onTriggered={(runId) => navigate(`/runs/${runId}`)}
        />
      )}
    </div>
  );
}

function RunModal({
  workflowId,
  onClose,
  onTriggered,
}: {
  workflowId: string;
  onClose: () => void;
  onTriggered: (runId: string) => void;
}) {
  const [json, setJson] = useState(
    JSON.stringify(
      { subject: "Production API down", body: "All requests are 503 in us-east-1." },
      null,
      2,
    ),
  );
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      const input = JSON.parse(json) as unknown;
      const r = await api.triggerRun(workflowId, input);
      onTriggered(r.runId);
    } catch (e) {
      setErr((e as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded shadow-lg w-[600px] max-w-[90vw] p-4">
        <h2 className="text-lg font-semibold mb-2">Trigger run</h2>
        <p className="text-sm text-slate-500 mb-2">
          Provide a JSON object that will be sent as the run input.
        </p>
        <textarea
          value={json}
          onChange={(e) => setJson(e.target.value)}
          className="w-full h-48 font-mono text-xs border border-slate-300 rounded p-2"
        />
        {err && <p className="text-sm text-red-700 mt-2">{err}</p>}
        <div className="flex justify-end gap-2 mt-3">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-slate-300 rounded">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="px-3 py-1.5 text-sm bg-slate-900 text-white rounded disabled:opacity-50"
          >
            {submitting ? "Triggering…" : "Run"}
          </button>
        </div>
      </div>
    </div>
  );
}
