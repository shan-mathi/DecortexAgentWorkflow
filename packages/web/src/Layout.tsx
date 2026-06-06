// Top-level layout: a small header with the project name + a link
// back to the workflows list. Pages render inside `<main>`.

import { Link, Outlet } from "react-router-dom";

export function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="font-semibold text-slate-900">
            Agent Workflow Engine
          </Link>
          <nav className="text-sm text-slate-600 flex gap-4">
            <Link to="/" className="hover:text-slate-900">
              Workflows
            </Link>
            <Link to="/new" className="hover:text-slate-900">
              New
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
