import path from "node:path";
import { workflow } from "@workflow/vitest";
import { defineConfig } from "vitest/config";

/**
 * Orchestration tests for `leadWorkflow`.
 *
 * Separate from the main config because the plugin transforms the `"use
 * workflow"` and `"use step"` directives and builds the runtime bundles, which
 * the ordinary unit suite neither needs nor should pay for. It runs the
 * workflow in-process against a fresh Local World per worker, so no server and
 * no deployment are involved — but the STEPS still reach Postgres, so these
 * need DATABASE_URL exactly like the other integration suites.
 */
export default defineConfig({
  plugins: [workflow()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "src/test/server-only-stub.ts"),
    },
  },
  test: {
    include: ["src/**/*.workflow.test.ts"],
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
