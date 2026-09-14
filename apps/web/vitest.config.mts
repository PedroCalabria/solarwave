import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Modules that guard themselves with `server-only` still need to be
      // loadable in the node test runner; the guard is a build-time concern.
      "server-only": path.resolve(__dirname, "src/test/server-only-stub.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    // Orchestration tests need the workflow plugin to compile the
    // directives; they run from vitest.workflow.config.mts instead.
    exclude: ["src/**/*.workflow.test.ts", "**/node_modules/**"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
