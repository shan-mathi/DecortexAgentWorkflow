// Deterministic, deployable LLMProvider used by tests, dev mode, the
// load-test script, and as a real provider in AWS behind
// `LLM_PROVIDER=fake`.

export * from "./fakeLlm.js";
export * from "./failures.js";
export * from "./latency.js";
