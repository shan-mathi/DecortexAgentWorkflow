import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout.js";
import { CreateWorkflowPage } from "./pages/CreateWorkflowPage.js";
import { ExecutePage } from "./pages/ExecutePage.js";
import { ExecutionsPage } from "./pages/ExecutionsPage.js";
import { ExecutionTracePage } from "./pages/ExecutionTracePage.js";
import { NodesPage } from "./pages/NodesPage.js";
import { WorkflowDetailPage } from "./pages/WorkflowDetailPage.js";
import { WorkflowsPage } from "./pages/WorkflowsPage.js";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<WorkflowsPage />} />
          <Route path="nodes" element={<NodesPage />} />
          <Route path="workflows/new" element={<CreateWorkflowPage />} />
          <Route path="workflows/:id" element={<WorkflowDetailPage />} />
          <Route path="workflows/:id/execute" element={<ExecutePage />} />
          <Route path="executions" element={<ExecutionsPage />} />
          <Route path="executions/:id" element={<ExecutionTracePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
