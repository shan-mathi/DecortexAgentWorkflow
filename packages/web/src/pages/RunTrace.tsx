// Run trace page. Polls GET /runs/:id every 1s while the run is
// non-terminal, renders the same React Flow graph with status
// colours, and shows a side panel with the selected node's details.

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import type { NodeStatus, RunTrace, WorkflowDef } from "@workflow-engine/shared";

import { api } from "../api.js";
import { Graph } from "../Graph.js";
import { Error, Loading } from "./WorkflowsList.js";

const TERMINAL = new Set(["SUCCEEDED", "FAILED"]);

export function RunTracePage() {
  const { id } = useParams<{ id: string }>();
  const [trace, setTrace] = useState<RunTrace | null>(null);
  const [def, setDef] = useState<WorkflowDef | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!id) return;
    let stopped = false;
    const tick = async () => {
      try {
        const t = await api.getRun(id);
        if (stopped) return;
        setTrace(t);
        if (!def && t.meta.workflowId) {
          api.getWorkflow(t.meta.workflowId).then(setDef).catch(() => {});
        }
        if (!TERMINAL.has(t.meta.status)) {
          timer.current = window.setTimeout(tick, 1000);
        }
      } catch (e) {
        setErr((e as Error).message);
      }
    };
    tick();
    return () => {
      stopped = true;
      if (timer.current) window.clearTimeout(timer.current);
    };
    // We deliberately want this effect to run only when `id` changes;
    // `def` is fetched once inside `tick` via a stale-closure-safe ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const statusByNodeId = useMemo<Record<string, NodeStatus | "RUNNING" | "PENDING">>(() => {
    if (!trace) return {};
    const m: Record<string, NodeStatus | "RUNNING" | "PENDING"> = {};
    for (const n of trace.nodeExecutions) m[n.nodeId] = n.status;
    return m;
  }, [trace]);

  if (err) return <Error message={err} />;
  if (!trace) return <Loading />;

  const selectedNode = selected
    ? trace.nodeExecutions.find((n) => n.nodeId === selected) ?? null
    : null;

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Run {trace.meta.runId.slice(0, 8)}…</h1>
        <p className="text-sm text-slate-500">
          status:{" "}
          <span
            className={
              "font-mono " +
              (trace.meta.status === "SUCCEEDED"
                ? "text-green-700"
                : trace.meta.status === "FAILED"
                  ? "text-red-700"
                  : "text-blue-700")
            }
          >
            {trace.meta.status}
          </span>
          {" · "}
          started {new Date(trace.meta.startedAt).toLocaleTimeString()}
          {trace.meta.endedAt &&
            ` · ended ${new Date(trace.meta.endedAt).toLocaleTimeString()}`}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          {def ? (
            <Graph
              def={def}
              statusByNodeId={statusByNodeId}
              onNodeClick={setSelected}
              selectedNodeId={selected}
            />
          ) : (
            <div className="h-[500px] bg-white border border-slate-200 rounded flex items-center justify-center text-slate-500">
              Loading graph…
            </div>
          )}
          <div className="mt-3">
            <h2 className="font-semibold mb-2 text-sm">Run input</h2>
            <pre className="bg-white border border-slate-200 rounded p-3 text-xs overflow-auto max-h-40">
              {JSON.stringify(trace.meta.input, null, 2)}
            </pre>
          </div>
        </div>

        <aside className="col-span-1">
          <h2 className="font-semibold mb-2 text-sm">
            {selectedNode ? `Node: ${selectedNode.nodeId}` : "Click a node"}
          </h2>
          {selectedNode ? (
            <div className="space-y-3 text-sm">
              <Field label="status" value={selectedNode.status} mono />
              <Field label="durationMs" value={String(selectedNode.durationMs)} mono />
              <Field label="attemptCount" value={String(selectedNode.attemptCount)} mono />
              {selectedNode.tokenUsage && (
                <Field
                  label="tokenUsage"
                  value={`prompt:${selectedNode.tokenUsage.promptTokens}, completion:${selectedNode.tokenUsage.completionTokens}`}
                  mono
                />
              )}
              {selectedNode.error && (
                <div>
                  <div className="text-xs text-slate-500 mb-1">error</div>
                  <pre className="bg-red-50 border border-red-200 rounded p-2 text-xs overflow-auto max-h-40">
                    {selectedNode.error.message}
                  </pre>
                </div>
              )}
              <div>
                <div className="text-xs text-slate-500 mb-1">output</div>
                <pre className="bg-slate-50 border border-slate-200 rounded p-2 text-xs overflow-auto max-h-72">
                  {JSON.stringify(selectedNode.output, null, 2)}
                </pre>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">input</div>
                <pre className="bg-slate-50 border border-slate-200 rounded p-2 text-xs overflow-auto max-h-72">
                  {JSON.stringify(selectedNode.input, null, 2)}
                </pre>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              Click a node in the graph to inspect its input, output, duration, attempts,
              and token usage.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={mono ? "font-mono text-sm" : "text-sm"}>{value}</div>
    </div>
  );
}
