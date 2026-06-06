// KnowledgeBaseRetrievalNode — the showcase plugin proving the
// platform's plugin model handles a real RAG-pattern retrieval node.
//
// Retrieval is a graph node with its own input, output, status,
// duration, retry policy, and token attribution — visible in the
// trace alongside every other node.
//
// We keep the engine package free of `pg` by accepting a minimal
// `QueryRunner` interface. The Postgres pool happens to satisfy it,
// and tests can pass a hand-rolled fake.

import { z } from "zod";

import type { LLMProvider, NodeContext, NodeResult } from "@workflow-engine/shared";

import type { NodeExecutor } from "../registry.js";
import { resolveTemplate } from "../template.js";

export interface QueryRunner {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export const KbRetrievalConfigSchema = z
  .object({
    knowledgeBase: z.enum(["tickets"]),
    queryTemplate: z.string().min(1),
    topK: z.number().int().positive().max(50).default(3),
    terminalOnFailure: z.boolean().optional(),
  })
  .strict();

export type KbRetrievalConfig = z.infer<typeof KbRetrievalConfigSchema>;

interface RetrievedDoc {
  id: string;
  subject: string;
  resolution: string;
  urgency: string;
  similarity: number;
}

export class KnowledgeBaseRetrievalNode implements NodeExecutor<KbRetrievalConfig> {
  readonly type = "kb-retrieval";
  readonly displayName = "Knowledge Base Retrieval";
  readonly description = "Vector-similarity search over a seeded corpus. Returns top-K rows.";
  readonly category = "data" as const;
  readonly configSchema = KbRetrievalConfigSchema;

  constructor(
    private readonly db: QueryRunner,
    private readonly llm: LLMProvider,
  ) {}

  async execute(config: KbRetrievalConfig, ctx: NodeContext): Promise<NodeResult> {
    const query = resolveTemplate(config.queryTemplate, ctx);
    const { vector, tokenUsage } = await this.llm.embed({ text: query });
    const vec = `[${vector.join(",")}]`;

    const { rows } = await this.db.query(
      `SELECT id::text AS id, subject, resolution, urgency,
              1 - (embedding <=> $1::vector) AS similarity
         FROM tickets_seed
         ORDER BY embedding <=> $1::vector
         LIMIT $2`,
      [vec, config.topK],
    );

    return {
      output: { documents: rows as RetrievedDoc[], query },
      status: "SUCCEEDED",
      durationMs: 0,
      tokenUsage,
    };
  }
}
