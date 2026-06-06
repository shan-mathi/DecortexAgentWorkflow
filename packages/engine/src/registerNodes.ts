// Single registration entry point.
//
// Both Lambdas (executor and API) import this — the executor to dispatch
// work, the API to surface `GET /node-types`. esbuild static-analyses
// imports from each Lambda's entry handler, so anything reached here
// lands in the bundle.
//
// Adding a new node type is exactly two diffs:
//   1. one file under `src/builtins/` or `src/plugins/`
//   2. one import + one `register()` call here

import type { LLMProvider } from "@workflow-engine/shared";

import { BranchNode } from "./builtins/branch.js";
import { HTTPNode } from "./builtins/http.js";
import { LLMNode } from "./builtins/llm.js";
import { TransformNode } from "./builtins/transform.js";
import { KnowledgeBaseRetrievalNode, type QueryRunner } from "./plugins/kbRetrieval.js";
import { NodeRegistry } from "./registry.js";

export interface NodeDeps {
  llm: LLMProvider;
  /**
   * Query runner used by `kb-retrieval`. The Postgres pool from
   * `packages/storage` satisfies this interface; tests can pass a
   * fake. Keeps the engine free of any `pg` import.
   */
  db?: QueryRunner;
}

/**
 * Build a registry pre-populated with every built-in plus the
 * `kb-retrieval` plugin (when `deps.db` is provided).
 *
 * Adding a new node type is exactly: write the file, import here,
 * call `register()`. The same registry is consumed by the executor
 * (dispatch) and the API (`GET /node-types`).
 */
export function registerNodes(registry: NodeRegistry, deps: NodeDeps): NodeRegistry {
  registry.register(new LLMNode(deps.llm));
  registry.register(new HTTPNode());
  registry.register(new BranchNode());
  registry.register(new TransformNode());
  if (deps.db) {
    registry.register(new KnowledgeBaseRetrievalNode(deps.db, deps.llm));
  }
  return registry;
}

// Backwards-compatible alias — older imports may still use the old name.
export const registerBuiltins = registerNodes;
