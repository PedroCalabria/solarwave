import { defineConfig } from "vitest/config";

/**
 * Integration tests. Like `@solarwave/db`, they fall back to PGlite when no
 * DATABASE_URL is reachable, so they need no server. Kept out of `pnpm test`
 * for the same reason that package keeps them out: they migrate a database.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
