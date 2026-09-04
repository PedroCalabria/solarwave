import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createStandaloneDb } from "./client";
import { directDatabaseUrl } from "./env";

/** Applies pending migrations from ./drizzle using the direct (non-pooled) connection. */
export async function runMigrations(url = directDatabaseUrl()): Promise<void> {
  if (!url) throw new Error("No database URL configured (DATABASE_URL_UNPOOLED / POSTGRES_URL_NON_POOLING / DATABASE_URL)");
  const { db, close } = createStandaloneDb(url);
  try {
    const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigrations()
    .then(() => {
      console.log("Migrations applied.");
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
