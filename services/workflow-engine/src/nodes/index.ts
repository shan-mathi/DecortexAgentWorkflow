// Register all built-in node handlers.

import { NodeHandlerRegistry } from "./node-handler.js";
import { BranchHandler } from "./builtins/branch-handler.js";
import { HTTPHandler } from "./builtins/http-handler.js";
import { LLMHandler } from "./builtins/llm-handler.js";
import { TransformHandler } from "./builtins/transform-handler.js";

export { NodeHandlerRegistry } from "./node-handler.js";
export type { NodeHandler } from "./node-handler.js";

export function createHandlerRegistry(): NodeHandlerRegistry {
  const registry = new NodeHandlerRegistry();
  registry.register(new LLMHandler());
  registry.register(new HTTPHandler());
  registry.register(new BranchHandler());
  registry.register(new TransformHandler());
  return registry;
}
