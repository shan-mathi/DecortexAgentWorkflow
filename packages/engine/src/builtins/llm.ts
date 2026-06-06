// LLM node — calls `LLMProvider.complete` with a templated prompt.
//
// Token usage from the provider is attached to the result so the trace
// records LLM cost per node. The wrapper (`runNodeWithRetry`) sets
// `durationMs`; node code does not need to.

import { z } from "zod";

import type { LLMProvider, NodeContext, NodeResult } from "@workflow-engine/shared";

import type { NodeExecutor } from "../registry.js";
import { resolveTemplate } from "../template.js";

export const LLMConfigSchema = z
  .object({
    promptTemplate: z.string().min(1),
    model: z.string().default("gpt-4o-mini"),
    maxTokens: z.number().int().positive().optional(),
    retry: z
      .object({
        maxAttempts: z.number().int().positive(),
        backoffMs: z.number().int().nonnegative(),
        jitter: z.number().min(0).max(1),
      })
      .partial()
      .optional(),
    terminalOnFailure: z.boolean().optional(),
  })
  .strict();

export type LLMConfig = z.infer<typeof LLMConfigSchema>;

export class LLMNode implements NodeExecutor<LLMConfig> {
  readonly type = "llm";
  readonly displayName = "Call LLM";
  readonly description = "Send a templated prompt to the configured LLMProvider.";
  readonly category = "ai" as const;
  readonly configSchema = LLMConfigSchema;

  constructor(private readonly llm: LLMProvider) {}

  async execute(config: LLMConfig, ctx: NodeContext): Promise<NodeResult> {
    const prompt = resolveTemplate(config.promptTemplate, ctx);
    const completionArgs: { prompt: string; model: string; maxTokens?: number } = {
      prompt,
      model: config.model,
    };
    if (config.maxTokens !== undefined) completionArgs.maxTokens = config.maxTokens;
    const { text, tokenUsage } = await this.llm.complete(completionArgs);
    return {
      output: { text },
      status: "SUCCEEDED",
      durationMs: 0,
      tokenUsage,
    };
  }
}
