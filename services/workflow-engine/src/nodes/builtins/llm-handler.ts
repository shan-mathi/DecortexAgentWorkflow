// LLM Node Handler — generic Bedrock/mock caller.
//
// This handler's ONLY job: resolve the prompt template against
// upstream context, call the LLM (Bedrock in prod, mock in dev),
// return the response text + token usage.
//
// All "intelligence" (what the prompt says, how the output is used)
// lives in the registered node's config. The handler is a dumb pipe
// between the template engine and the LLM provider.

import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

import type { NodeContext, NodeResult } from "../../types/index.js";

import { resolveTemplate } from "../../executor/template.js";
import type { NodeHandler } from "../node-handler.js";

interface LLMConfig {
  promptTemplate: string;
  model?: string;
  maxTokens?: number;
}

const DEFAULT_MODEL = "apac.amazon.nova-micro-v1:0";

export class LLMHandler implements NodeHandler {
  readonly category = "llm";
  private readonly client: BedrockRuntimeClient | null;
  private readonly useMock: boolean;

  constructor() {
    const provider = process.env.LLM_PROVIDER ?? "fake";
    this.useMock = provider !== "bedrock";
    this.client = this.useMock
      ? null
      : new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? "us-east-1" });
  }

  async execute(config: unknown, ctx: NodeContext): Promise<NodeResult> {
    const cfg = config as LLMConfig;
    if (!cfg.promptTemplate) {
      return {
        output: null,
        status: "FAILED",
        durationMs: 0,
        error: { message: "LLM node requires a promptTemplate in config." },
      };
    }

    const prompt = resolveTemplate(cfg.promptTemplate, ctx);
    const model = cfg.model ?? DEFAULT_MODEL;
    const maxTokens = cfg.maxTokens ?? 1024;

    if (this.useMock) {
      return this.executeMock(prompt);
    }
    return this.executeBedrock(prompt, model, maxTokens);
  }

  private async executeBedrock(prompt: string, model: string, maxTokens: number): Promise<NodeResult> {
    // Build request body based on model provider.
    // Nova and Anthropic use the messages format.
    // Titan uses inputText format.
    const isAnthropic = model.includes("anthropic.");
    const isNova = model.includes("amazon.nova");
    const isTitan = model.includes("amazon.titan-text");

    let requestBody: string;
    if (isNova) {
      requestBody = JSON.stringify({
        messages: [{ role: "user", content: [{ text: prompt }] }],
        inferenceConfig: { max_new_tokens: maxTokens, temperature: 0.3 },
      });
    } else if (isAnthropic) {
      requestBody = JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      });
    } else if (isTitan) {
      requestBody = JSON.stringify({
        inputText: prompt,
        textGenerationConfig: { maxTokenCount: maxTokens, temperature: 0.3 },
      });
    } else {
      // Generic fallback — messages format
      requestBody = JSON.stringify({
        max_tokens: maxTokens,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      });
    }

    const command = new InvokeModelCommand({
      modelId: model,
      contentType: "application/json",
      accept: "application/json",
      body: new TextEncoder().encode(requestBody),
    });

    const response = await this.client!.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.body));

    // Parse response based on model provider
    let text: string;
    let promptTokens = 0;
    let completionTokens = 0;

    if (isAnthropic) {
      text = result.content?.[0]?.text ?? "";
      promptTokens = result.usage?.input_tokens ?? 0;
      completionTokens = result.usage?.output_tokens ?? 0;
    } else if (isNova) {
      // Nova response: { output: { message: { content: [{text}] } }, usage: {inputTokens, outputTokens} }
      text = result.output?.message?.content?.[0]?.text ?? "";
      promptTokens = result.usage?.inputTokens ?? Math.ceil(prompt.length / 4);
      completionTokens = result.usage?.outputTokens ?? Math.ceil(text.length / 4);
    } else if (isTitan) {
      text = result.results?.[0]?.outputText ?? "";
      promptTokens = result.inputTextTokenCount ?? Math.ceil(prompt.length / 4);
      completionTokens = result.results?.[0]?.tokenCount ?? Math.ceil(text.length / 4);
    } else {
      text = result.output?.message?.content?.[0]?.text ?? result.content?.[0]?.text ?? JSON.stringify(result);
      promptTokens = Math.ceil(prompt.length / 4);
      completionTokens = Math.ceil(text.length / 4);
    }

    return {
      output: { text },
      status: "SUCCEEDED",
      durationMs: 0,
      tokenUsage: { promptTokens, completionTokens },
    };
  }

  private executeMock(prompt: string): Promise<NodeResult> {
    // Mock LLM: returns a deterministic, prompt-length-based response.
    // No domain logic here — the mock simply produces stable output
    // for any prompt. The prompt's content determines what the workflow
    // does (classify → returns label, draft → returns text), but that
    // is driven by the promptTemplate in the node config, not by the
    // handler.
    //
    // For testing the ops-ticket workflow, the mock returns the first
    // word it finds that matches LOW/MED/HIGH if the prompt asks for
    // classification, otherwise a generic acknowledgement.
    const text = mockResponse(prompt);

    return Promise.resolve({
      output: { text },
      status: "SUCCEEDED",
      durationMs: 0,
      tokenUsage: {
        promptTokens: Math.ceil(prompt.length / 4),
        completionTokens: Math.ceil(text.length / 4),
      },
    });
  }
}

/**
 * Deterministic mock responder.
 *
 * This is NOT domain logic in the handler — it's a test utility that
 * produces plausible-looking LLM output for any prompt. The
 * "intelligence" is that it respects the format the prompt asks for
 * (e.g. "Reply with only the label" → returns just a label).
 */
function mockResponse(prompt: string): string {
  const lower = prompt.toLowerCase();

  // If the prompt asks for a single-word classification label
  if (lower.includes("reply with only the label") || lower.includes("respond with only")) {
    if (lower.includes("503") || lower.includes("outage") || lower.includes("down") || lower.includes("critical") || lower.includes("losing")) {
      return "HIGH";
    }
    if (lower.includes("slow") || lower.includes("intermittent") || lower.includes("lag") || lower.includes("delayed")) {
      return "MED";
    }
    return "LOW";
  }

  // For any other prompt, return a generic response
  return "Thank you for reaching out. We have received your request and our team is investigating. We will provide an update shortly.";
}
