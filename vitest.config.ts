import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["services/*/tst/**/*.{test,spec}.ts"],
    environment: "node",
    passWithNoTests: true,
  },
});
