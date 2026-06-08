import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";

export function ExecutePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [input, setInput] = useState(JSON.stringify({ subject: "API down", description: "503 errors everywhere." }, null, 2));
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!id) return;
    setSubmitting(true);
    setErr(null);
    try {
      const parsed = JSON.parse(input) as unknown;
      const r = await api.triggerExecution(id, parsed);
      navigate(`/executions/${r.runId}`);
    } catch (e) {
      setErr((e as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold mb-4">Execute Workflow</h1>
      <p className="text-sm text-slate-500 mb-3">Provide JSON input for the workflow run.</p>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={10}
        className="w-full border border-slate-300 rounded p-3 font-mono text-xs"
      />
      {err && <p className="text-sm text-red-700 mt-2">{err}</p>}
      <button onClick={submit} disabled={submitting} className="mt-3 px-4 py-2 bg-slate-900 text-white rounded text-sm disabled:opacity-50">
        {submitting ? "Executing..." : "Run"}
      </button>
    </div>
  );
}
