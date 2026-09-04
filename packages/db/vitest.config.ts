import { defineConfig } from "vitest/config";

/** Unit tests: no database required. */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts", "node_modules/**"],
  },
});
