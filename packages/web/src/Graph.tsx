// Read-only React Flow graph used by both the workflow detail page
// and the run trace page. The trace page passes a `statusByNodeId`
// map so node colours reflect per-node status.

import { useMemo } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";

import type { NodeStatus, WorkflowDef } from "@workflow-engine/shared";

import { useNodeTypes } from "./nodeTypes.js";

interface GraphProps {
  def: WorkflowDef;
  statusByNodeId?: Record<string, NodeStatus | "RUNNING" | "PENDING">;
  onNodeClick?: (nodeId: string) => void;
  selectedNodeId?: string | null;
}

const statusBg: Record<string, string> = {
  PENDING: "#e2e8f0", // gray-200
  RUNNING: "#bfdbfe", // blue-200
  SUCCEEDED: "#bbf7d0", // green-200
  FAILED: "#fecaca", // red-200
  SKIPPED: "#f1f5f9", // slate-100
};

const statusBorder: Record<string, string> = {
  PENDING: "#cbd5e1",
  RUNNING: "#3b82f6",
  SUCCEEDED: "#16a34a",
  FAILED: "#dc2626",
  SKIPPED: "#94a3b8",
};

export function Graph({ def, statusByNodeId, onNodeClick, selectedNodeId }: GraphProps) {
  const { byType } = useNodeTypes();

  const { nodes, edges } = useMemo(() => {
    const ns: Node[] = def.nodes.map((n) => {
      const status = statusByNodeId?.[n.id];
      const t = byType[n.type];
      const isSkipped = status === "SKIPPED";
      return {
        id: n.id,
        position: { x: n.position_x, y: n.position_y },
        data: { label: nodeLabel(n.id, n.name, t?.displayName ?? n.type, n.type) },
        style: {
          background: status ? statusBg[status] : "#fff",
          border: `1px solid ${status ? statusBorder[status] : selectedNodeId === n.id ? "#0f172a" : "#cbd5e1"}`,
          borderStyle: isSkipped ? "dashed" : "solid",
          padding: 8,
          fontSize: 12,
          minWidth: 140,
          opacity: isSkipped ? 0.6 : 1,
        },
      };
    });
    const es: Edge[] = def.edges.map((e, i) => ({
      id: `${e.from}-${e.to}-${i}`,
      source: e.from,
      target: e.to,
      label: e.condition_expression ?? undefined,
      style: { stroke: "#94a3b8" },
    }));
    return { nodes: ns, edges: es };
  }, [def, statusByNodeId, byType, selectedNodeId]);

  return (
    <div className="w-full h-[500px] bg-white border border-slate-200 rounded">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        fitView
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => onNodeClick?.(n.id)}
      >
        <Background gap={16} size={1} color="#e2e8f0" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function nodeLabel(id: string, name: string | undefined, displayName: string, type: string): string {
  if (name) return `${name}\n[${type}] ${id}`;
  return `${displayName}\n[${type}] ${id}`;
}
