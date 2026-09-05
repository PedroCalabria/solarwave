import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/eval/**", "src/**/*.integration.test.ts", "node_modules/**"],
  },
});
