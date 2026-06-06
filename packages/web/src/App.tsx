// Top-level router. We use react-router-dom v6 nested routes so the
// header layout stays mounted while pages swap.

import { BrowserRouter, Route, Routes } from "react-router-dom";

import { Layout } from "./Layout.js";
import { NodeTypesProvider } from "./nodeTypes.js";
import { RunsList } from "./pages/RunsList.js";
import { RunTracePage } from "./pages/RunTrace.js";
import { WorkflowDetail } from "./pages/WorkflowDetail.js";
import { WorkflowEditor } from "./pages/WorkflowEditor.js";
import { WorkflowsList } from "./pages/WorkflowsList.js";

export function App() {
  return (
    <NodeTypesProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<WorkflowsList />} />
            <Route path="new" element={<WorkflowEditor />} />
            <Route path="workflows/:id" element={<WorkflowDetail />} />
            <Route path="workflows/:id/runs" element={<RunsList />} />
            <Route path="runs/:id" element={<RunTracePage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </NodeTypesProvider>
  );
}
