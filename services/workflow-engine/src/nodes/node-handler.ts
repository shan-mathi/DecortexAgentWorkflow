// Node Handler interface — the in-process contract for executing a node.
//
// Each base node type (LLM, HTTP, Branch, Transform) has a handler
// that implements this interface. The Executor dispatches to the
// appropriate handler based on the node's category.
//
// Unlike the monorepo's NodeExecutor (which was per-registered-node),
// handlers are per-CATEGORY. The registered node's config is passed
// as `config` and the handler uses it to customise behaviour.

import type { NodeContext, NodeResult } from "../types/index.js";

export interface NodeHandler {
  readonly category: string;
  execute(config: unknown, ctx: NodeContext): Promise<NodeResult>;
}

export class NodeHandlerRegistry {
  private readonly handlers = new Map<string, NodeHandler>();

  register(handler: NodeHandler): void {
    if (this.handlers.has(handler.category)) {
      throw new Error(`Handler already registered for category: ${handler.category}`);
    }
    this.handlers.set(handler.category, handler);
  }

  get(category: string): NodeHandler {
    const h = this.handlers.get(category);
    if (!h) throw new Error(`No handler for category: ${category}`);
    return h;
  }

  list(): string[] {
    return Array.from(this.handlers.keys());
  }
}
