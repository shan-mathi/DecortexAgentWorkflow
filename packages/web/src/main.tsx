// React entry point. Wires the router and global styles.
import "./index.css";

import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App.js";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
