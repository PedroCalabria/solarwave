import { defineConfig } from "vitest/config";

/**
 * Integration tests run against the database in DATABASE_URL (or POSTGRES_URL).
 * Use a throwaway database: the suite truncates tables between tests.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
