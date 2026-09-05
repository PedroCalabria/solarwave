/**
 * `server-only` throws when imported outside a Server Component, which stops
 * vitest from loading modules that legitimately guard themselves with it. The
 * guard matters at build time, not in a node test runner.
 */
export {};
