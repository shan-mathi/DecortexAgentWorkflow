import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type NodeExecution, type RunTrace } from "../api.js";
import { StatusBadge } from "../components/StatusBadge.js";

const TERMINAL = new Set(["SUCCEEDED", "FAILED"]);

export function ExecutionTracePage() {
  const { id } = useParams<{ id: string }>();
  const [trace, setTrace] = useState<RunTrace | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<NodeExecution | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!id) return;
    let stopped = false;
    const tick = async () => {
      try {
        const t = await api.getExecution(id);
        if (stopped) return;
        setTrace(t);
        if (!TERMINAL.has(t.meta.status)) {
          timer.current = window.setTimeout(tick, 1000);
        }
      } catch (e) {
        setErr((e as Error).message);
      }
    };
    tick();
    return () => { stopped = true; if (timer.current) clearTimeout(timer.current); };
  }, [id]);

  if (err) return <div className="text-red-700">Error: {err}</div>;
  if (!trace) return <div className="text-slate-500">Loading...</div>;

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Execution Trace</h1>
        <div className="flex items-center gap-3 mt-1">
          <StatusBadge status={trace.meta.status} />
          <span className="text-sm text-slate-500">
            started {new Date(trace.meta.startedAt).toLocaleString()}
            {trace.meta.endedAt && ` · ended ${new Date(trace.meta.endedAt).toLocaleString()}`}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Node list */}
        <div className="col-span-2 space-y-2">
          {trace.nodeExecutions.map((ne) => (
            <div
              key={ne.nodeId}
              onClick={() => setSelected(ne)}
              className={`bg-white border rounded p-3 cursor-pointer hover:border-blue-400 ${
                selected?.nodeId === ne.nodeId ? "border-blue-500 ring-1 ring-blue-200" : "border-slate-200"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusBadge status={ne.status} />
                  <span className="font-medium text-sm">{ne.nodeName ?? ne.nodeId}</span>
                  {ne.nodeType && <span className="text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{ne.nodeType}</span>}
                </div>
                <div className="text-xs text-slate-500 tabular-nums">
                  {ne.durationMs}ms
                  {ne.tokenUsage && ` · ${ne.tokenUsage.promptTokens + ne.tokenUsage.completionTokens} tokens`}
                </div>
              </div>
              {ne.status === "SUCCEEDED" && ne.output != null && (
                <div className="mt-2 text-xs text-slate-600 truncate max-w-xl">
                  {formatOutput(ne.output)}
                </div>
              )}
              {ne.error && (
                <div className="mt-2 text-xs text-red-700">{ne.error.message}</div>
              )}
            </div>
          ))}
        </div>

        {/* Detail panel */}
        <aside className="col-span-1">
          {selected ? (
            <div className="bg-white border border-slate-200 rounded p-3 sticky top-6">
              <h2 className="font-semibold text-sm mb-3">{selected.nodeName ?? selected.nodeId}</h2>
              <dl className="space-y-2 text-sm">
                <Field label="Node ID" value={selected.nodeId} mono />
                {selected.nodeType && <Field label="Type" value={selected.nodeType} />}
                <Field label="Status" value={selected.status} />
                <Field label="Duration" value={`${selected.durationMs} ms`} mono />
                <Field label="Attempts" value={String(selected.attemptCount)} mono />
                {selected.tokenUsage && (
                  <Field label="Tokens" value={`prompt: ${selected.tokenUsage.promptTokens}, completion: ${selected.tokenUsage.completionTokens}`} mono />
                )}
                {selected.error && (
                  <div>
                    <dt className="text-xs text-slate-500">Error</dt>
                    <dd className="bg-red-50 border border-red-200 rounded p-2 text-xs mt-1 overflow-auto max-h-32">
                      {selected.error.message}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-slate-500">Output</dt>
                  <dd className="bg-slate-50 border border-slate-200 rounded p-2 text-xs font-mono mt-1 overflow-auto max-h-48 whitespace-pre-wrap">
                    {JSON.stringify(selected.output, null, 2)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Input</dt>
                  <dd className="bg-slate-50 border border-slate-200 rounded p-2 text-xs font-mono mt-1 overflow-auto max-h-48 whitespace-pre-wrap">
                    {JSON.stringify(selected.input, null, 2)}
                  </dd>
                </div>
              </dl>
            </div>
          ) : (
            <div className="text-sm text-slate-500 bg-white border border-dashed border-slate-300 rounded p-4 text-center">
              Click a node to inspect details
            </div>
          )}
        </aside>
      </div>

      <div className="mt-4">
        <h2 className="font-semibold text-sm mb-2">Run Input</h2>
        <pre className="bg-white border border-slate-200 rounded p-3 text-xs overflow-auto max-h-32">
          {JSON.stringify(trace.meta.input, null, 2)}
        </pre>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={mono ? "font-mono text-sm" : "text-sm"}>{value}</dd>
    </div>
  );
}

function formatOutput(output: unknown): string {
  if (!output || typeof output !== "object") return String(output);
  const obj = output as Record<string, unknown>;
  if ("text" in obj) return String(obj.text).slice(0, 120);
  if ("takenBranch" in obj) return `→ ${obj.takenBranch}`;
  return JSON.stringify(output).slice(0, 120);
}
