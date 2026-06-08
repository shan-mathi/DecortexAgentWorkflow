import { describe, expect, it } from "vitest";

import { resolveTemplate, TemplateError } from "../../src/executor/template.js";
import type { NodeContext } from "../../src/types/index.js";

function ctx(upstream: NodeContext["upstream"] = {}, runInput: unknown = { subject: "outage", description: "service down" }): NodeContext {
  return { runId: "r", nodeId: "n", runInput, upstream, metadata: { workflowId: "w", attempt: 1 } };
}

describe("resolveTemplate", () => {
  it("substitutes input.path", () => {
    expect(resolveTemplate("Subject: {{input.subject}}", ctx())).toBe("Subject: outage");
  });

  it("substitutes nodeId.path from upstream", () => {
    const u = { classify: { output: { text: "HIGH" }, status: "SUCCEEDED" as const, durationMs: 1 } };
    expect(resolveTemplate("urgency={{classify.text}}", ctx(u))).toBe("urgency=HIGH");
  });

  it("JSON-stringifies non-string values", () => {
    const u = { fetch: { output: { docs: [{ id: 1 }] }, status: "SUCCEEDED" as const, durationMs: 1 } };
    expect(resolveTemplate("docs={{fetch.docs}}", ctx(u))).toBe('docs=[{"id":1}]');
  });

  it("supports array indexing", () => {
    const u = { fetch: { output: { items: ["a", "b"] }, status: "SUCCEEDED" as const, durationMs: 1 } };
    expect(resolveTemplate("first={{fetch.items.0}}", ctx(u))).toBe("first=a");
  });

  it("tolerates whitespace in braces", () => {
    expect(resolveTemplate("x={{   input.subject   }}", ctx())).toBe("x=outage");
  });

  it("throws TemplateError on missing node", () => {
    expect(() => resolveTemplate("{{ghost.field}}", ctx())).toThrow(TemplateError);
  });

  it("throws TemplateError on missing path segment", () => {
    const u = { classify: { output: { text: "HIGH" }, status: "SUCCEEDED" as const, durationMs: 1 } };
    expect(() => resolveTemplate("{{classify.missing}}", ctx(u))).toThrow(TemplateError);
  });

  it("handles null/undefined values", () => {
    const u = { n: { output: { val: null }, status: "SUCCEEDED" as const, durationMs: 1 } };
    expect(resolveTemplate("v={{n.val}}", ctx(u))).toBe("v=null");
  });
});
