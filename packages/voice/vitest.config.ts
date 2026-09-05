import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/spike/**", "src/eval/run.ts", "src/**/*.integration.test.ts", "node_modules/**"],
  },
});
