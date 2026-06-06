// HTTPNode plugin-contract tests.
//
// We use a stub `fetch` via vi.stubGlobal so the contract suite does
// not actually hit the network. Real-network behaviour is exercised
// by integration tests in the API package.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pluginContract } from "../src/testing/pluginContract.js";
import { HTTPNode } from "../src/builtins/http.js";

const node = new HTTPNode();

const ctx = () => ({
  runId: "r",
  nodeId: "h",
  runInput: { id: 42 },
  upstream: {},
  metadata: { workflowId: "w", attempt: 1 },
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

pluginContract({
  name: "HTTPNode",
  executor: node,
  validConfig: {
    method: "GET",
    url: "https://example.com/api/users/{{input.id}}",
  },
  invalidConfig: { url: "not-a-url" },
  makeContext: ctx,
});

describe("HTTPNode happy path", () => {
  it("templates the URL and returns the response body", async () => {
    const cfg = node.configSchema.parse({
      method: "GET",
      url: "https://example.com/users/{{input.id}}",
    });
    const r = await node.execute(cfg, ctx());
    expect(r.status).toBe("SUCCEEDED");
    expect((r.output as { status: number }).status).toBe(200);
  });
});
