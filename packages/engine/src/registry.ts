// NodeRegistry — the compile-time map from node `type` strings to
// `NodeExecutor` implementations.
//
// The same registry instance is consumed by:
//   - the executor (to dispatch `node.type → executor.execute`)
//   - the API (`GET /node-types` lists registered types and their schemas
//     for UI palette + auto-generated config forms)
//
// "Plugin model" in this codebase means: implement `NodeExecutor` in one
// file, add one line in `registerNodes.ts`. No runtime loading, no S3,
// no Lambda Layers. The deploy script bundles the registered nodes into
// both Lambdas atomically.

import type { ZodType } from "zod";

import type { NodeContext, NodeResult } from "@workflow-engine/shared";

/**
 * Optional metadata that a node executor MAY expose so the UI can render
 * a richer palette without a separate config file.
 */
export interface NodeMetadata {
  displayName?: string;
  description?: string;
  category?: "ai" | "io" | "control" | "data";
}

/**
 * Single contract a node-type author implements.
 *
 * `type`         — unique string used in workflow definitions and registry lookup.
 * `configSchema` — Zod schema validated against `NodeDef.config` at workflow-create time.
 * `execute`      — the work; called by the executor with a typed config and the run context.
 *
 * `displayName` / `description` / `category` are optional UI hints. The
 * three structural members above are the actual contract.
 */
export interface NodeExecutor<Config = unknown> extends NodeMetadata {
  readonly type: string;
  readonly configSchema: ZodType<Config>;
  execute(config: Config, ctx: NodeContext): Promise<NodeResult>;
}

export class UnknownNodeTypeError extends Error {
  constructor(type: string) {
    super(`Unknown node type: ${type}`);
    this.name = "UnknownNodeTypeError";
  }
}

export class NodeRegistry {
  private readonly executors = new Map<string, NodeExecutor>();

  register(executor: NodeExecutor): void {
    if (this.executors.has(executor.type)) {
      throw new Error(`Node type already registered: ${executor.type}`);
    }
    this.executors.set(executor.type, executor);
  }

  get(type: string): NodeExecutor {
    const e = this.executors.get(type);
    if (!e) throw new UnknownNodeTypeError(type);
    return e;
  }

  has(type: string): boolean {
    return this.executors.has(type);
  }

  list(): Array<{
    type: string;
    configSchema: ZodType<unknown>;
    displayName?: string;
    description?: string;
    category?: NodeMetadata["category"];
  }> {
    return Array.from(this.executors.values()).map((e) => ({
      type: e.type,
      configSchema: e.configSchema,
      displayName: e.displayName,
      description: e.description,
      category: e.category,
    }));
  }
}
