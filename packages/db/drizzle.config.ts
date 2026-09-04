import { defineConfig } from "drizzle-kit";

/**
 * `drizzle-kit generate` only needs the schema. Commands that touch the
 * database (`push`, `studio`) read the direct (non-pooled) connection string.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url:
      process.env.DATABASE_URL_UNPOOLED ??
      process.env.POSTGRES_URL_NON_POOLING ??
      process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      "",
  },
  strict: true,
  verbose: true,
});
