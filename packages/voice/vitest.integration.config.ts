import { defineConfig } from "vitest/config";

/** Integration tests run on PGlite when no DATABASE_URL is reachable. */
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
