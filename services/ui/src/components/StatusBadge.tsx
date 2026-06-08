const colors: Record<string, string> = {
  SUCCEEDED: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
  RUNNING: "bg-blue-100 text-blue-800",
  PENDING: "bg-yellow-100 text-yellow-800",
  SKIPPED: "bg-slate-100 text-slate-600",
};

export function StatusBadge({ status }: { status: string }) {
  const cls = colors[status] ?? "bg-slate-100 text-slate-700";
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{status}</span>;
}
