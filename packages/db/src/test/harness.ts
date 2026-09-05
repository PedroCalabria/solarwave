import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createStandaloneDb, type Db } from "../client";
import { directDatabaseUrl } from "../env";
import { runMigrations } from "../migrate";
import * as schema from "../schema";

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

const TRUNCATE = sql`
  truncate table
    guardrail_violations,
    qualification_answers,
    criteria_audit_log,
    call_attempts,
    leads,
    qualification_criteria,
    settings,
    intake_rate_limits,
    employees
  restart identity cascade
`;

export type TestDb = { db: Db; truncate: () => Promise<void>; close: () => Promise<void>; kind: "server" | "pglite" };

/**
 * Integration-test database: migrates once, truncates between tests.
 *
 * Prefers a real server when DATABASE_URL points at a reachable one. Otherwise
 * falls back to PGlite, real Postgres compiled to WASM, so the suite runs with
 * no server to install and no shared database to corrupt. The fallback is
 * announced rather than silent, so a genuinely misconfigured server is still
 * visible.
 *
 * Caveat: PGlite is a single connection. Tests that need two writers racing for
 * the same row cannot run on it and should assert on the pure transition table
 * instead.
 */
export async function openTestDb(): Promise<TestDb> {
  const url = directDatabaseUrl();

  if (url) {
    try {
      await runMigrations(url);
      const { db, close } = createStandaloneDb(url);
      return {
        db,
        kind: "server",
        truncate: async () => {
          await db.execute(TRUNCATE);
        },
        close,
      };
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      console.warn(`[test-db] DATABASE_URL is unreachable (${reason}). Falling back to PGlite.`);
    }
  }

  const client = new PGlite();
  // The driver differs from the production one, but every query this repo runs
  // is plain Postgres, so the shared `Db` type still describes it.
  const db = drizzlePglite(client, { schema, casing: "snake_case" }) as unknown as Db;
  await migratePglite(db as never, { migrationsFolder: MIGRATIONS });

  return {
    db,
    kind: "pglite",
    truncate: async () => {
      await db.execute(TRUNCATE);
    },
    close: async () => {
      await client.close();
    },
  };
}
