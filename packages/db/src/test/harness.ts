import { sql } from "drizzle-orm";
import { createStandaloneDb, type Db } from "../client";
import { directDatabaseUrl } from "../env";
import { runMigrations } from "../migrate";

/**
 * Integration-test database: migrates once, truncates between tests.
 * Requires DATABASE_URL (or POSTGRES_URL) pointing at a throwaway database.
 */
export async function openTestDb(): Promise<{ db: Db; truncate: () => Promise<void>; close: () => Promise<void> }> {
  const url = directDatabaseUrl();
  if (!url) throw new Error("Integration tests need DATABASE_URL (or POSTGRES_URL)");

  await runMigrations(url);
  const { db, close } = createStandaloneDb(url);

  const truncate = async () => {
    await db.execute(sql`
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
    `);
  };

  return { db, truncate, close };
}
