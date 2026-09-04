import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { pooledDatabaseUrl } from "./env";
import * as schema from "./schema";

function createDb(url: string) {
  const client = postgres(url, {
    // Use Supabase's SESSION pooler (port 5432), not the transaction pooler
    // (6543). postgres-js pipelines the concurrent queries a page fires from
    // one `Promise.all` onto a single connection; in transaction mode
    // Supavisor hands each statement to a different server connection, the
    // replies stop correlating and the connection stalls in ClientRead with an
    // open transaction until `statement_timeout` cancels it. Session mode
    // gives us a dedicated server connection, so pipelining is safe.
    // These two stay on so the same client still works if a deployment is
    // pointed at the transaction pooler with serialised queries.
    prepare: false,
    fetch_types: false,
    max: 5,
    idle_timeout: 20,
    connect_timeout: 15,
  });
  return { db: drizzle(client, { schema, casing: "snake_case" }), client };
}

export type Db = ReturnType<typeof createDb>["db"];
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Either a database or a transaction handle; query functions accept both. */
export type DbOrTx = Db | Tx;

let cached: ReturnType<typeof createDb> | null = null;

/**
 * Lazily creates the client so `next build` does not crash before the
 * environment is provisioned (design D1). Plain function, no Proxy.
 */
export function getDb(): Db {
  if (!cached) {
    const url = pooledDatabaseUrl();
    if (!url) throw new Error("DATABASE_URL (or POSTGRES_URL) is not set");
    cached = createDb(url);
  }
  return cached.db;
}

/** Creates an independent client for scripts and tests that must close it. */
export function createStandaloneDb(url: string) {
  const { db, client } = createDb(url);
  return { db, close: () => client.end({ timeout: 5 }) };
}

export async function closeDb(): Promise<void> {
  if (cached) {
    await cached.client.end({ timeout: 5 });
    cached = null;
  }
}
