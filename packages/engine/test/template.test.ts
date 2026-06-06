// `resolveTemplate` tests.
//
// Three properties asserted:
//   - String values are inserted raw; non-string values are JSON-stringified.
//   - Missing references throw `TemplateError(ref, path)` rather than
//     producing a half-resolved string.
//   - Whitespace in `{{   ...   }}` is tolerated.

import { describe, expect, it } from "vitest";

import type { NodeContext } from "@workflow-engine/shared";

import { TemplateError, resolveTemplate } from "../src/template.js";

function ctx(
  upstream: NodeContext["upstream"],
  runInput: unknown = { subject: "outage", body: "service down" },
): NodeContext {
  return {
    runId: "r",
    nodeId: "n",
    runInput,
    upstream,
    metadata: { workflowId: "w", attempt: 1 },
  };
}

describe("resolveTemplate", () => {
  it("substitutes input.path", () => {
    const out = resolveTemplate("subject: {{input.subject}}", ctx({}));
    expect(out).toBe("subject: outage");
  });

  it("substitutes nodeId.path through ctx.upstream", () => {
    const u = {
      classify: {
        output: { text: "HIGH" },
        status: "SUCCEEDED" as const,
        durationMs: 1,
      },
    };
    const out = resolveTemplate("urgency={{classify.text}}", ctx(u));
    expect(out).toBe("urgency=HIGH");
  });

  it("JSON-stringifies non-string values", () => {
    const u = {
      fetch: {
        output: { documents: [{ id: 1 }, { id: 2 }] },
        status: "SUCCEEDED" as const,
        durationMs: 1,
      },
    };
    const out = resolveTemplate("docs: {{fetch.documents}}", ctx(u));
    expect(out).toBe('docs: [{"id":1},{"id":2}]');
  });

  it("supports array indexing via dotted path", () => {
    const u = {
      fetch: {
        output: { documents: [{ id: "a" }, { id: "b" }] },
        status: "SUCCEEDED" as const,
        durationMs: 1,
      },
    };
    const out = resolveTemplate("first={{fetch.documents.0.id}}", ctx(u));
    expect(out).toBe("first=a");
  });

  it("tolerates whitespace inside braces", () => {
    expect(resolveTemplate("x={{   input.subject   }}", ctx({}))).toBe(
      "x=outage",
    );
  });

  it("throws TemplateError on missing nodeId", () => {
    try {
      resolveTemplate("{{ghost.field}}", ctx({}));
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TemplateError);
    }
  });

  it("throws TemplateError on missing path segment", () => {
    const u = {
      classify: {
        output: { text: "HIGH" },
        status: "SUCCEEDED" as const,
        durationMs: 1,
      },
    };
    try {
      resolveTemplate("{{classify.does_not_exist}}", ctx(u));
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TemplateError);
      const te = e as TemplateError;
      expect(te.path).toContain("does_not_exist");
    }
  });
});
