// `GET /node-types` is fetched once per session and cached in a
// React context. Pages read it for: the editor palette, auto-form
// rendering, and node label/icon lookup on the workflow detail and
// run trace pages.

import React, { createContext, useContext, useEffect, useState } from "react";

import { api, type NodeTypeInfo } from "./api.js";

interface NodeTypesContext {
  byType: Record<string, NodeTypeInfo>;
  list: NodeTypeInfo[];
  loading: boolean;
  error: string | null;
}

const Ctx = createContext<NodeTypesContext>({
  byType: {},
  list: [],
  loading: true,
  error: null,
});

export function NodeTypesProvider({ children }: { children: React.ReactNode }) {
  const [list, setList] = useState<NodeTypeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listNodeTypes()
      .then((data) => {
        setList(data);
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  const byType = Object.fromEntries(list.map((n) => [n.type, n]));

  return <Ctx.Provider value={{ byType, list, loading, error }}>{children}</Ctx.Provider>;
}

export function useNodeTypes(): NodeTypesContext {
  return useContext(Ctx);
}
