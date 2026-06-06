import { defineConfig } from "vitest/config";

// Root Vitest config.
//
// Discovers tests across every workspace package: per-package `src/` colocated
// `*.test.ts` files for unit tests, and per-package `test/` directories for
// integration suites.
//
// Individual packages may override or extend this with their own
// `vitest.config.ts` (e.g. for testcontainers-backed integration tests with a
// longer timeout).
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.{test,spec}.ts", "packages/*/test/**/*.{test,spec}.ts"],
    environment: "node",
    passWithNoTests: true,
    reporters: ["default"],
  },
});
