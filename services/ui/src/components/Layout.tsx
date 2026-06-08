import { Link, Outlet, useLocation } from "react-router-dom";

const navItems = [
  { path: "/", label: "Workflows" },
  { path: "/nodes", label: "Nodes" },
  { path: "/executions", label: "Executions" },
];

export function Layout() {
  const loc = useLocation();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="font-bold text-lg text-slate-900">
            Workflow Engine
          </Link>
          <nav className="flex gap-4 text-sm">
            {navItems.map((n) => (
              <Link
                key={n.path}
                to={n.path}
                className={loc.pathname === n.path ? "text-blue-700 font-medium" : "text-slate-600 hover:text-slate-900"}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
