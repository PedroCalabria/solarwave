/**
 * Connection strings. The Vercel Marketplace Supabase integration injects
 * `POSTGRES_URL` (transaction pooler) and `POSTGRES_URL_NON_POOLING` (direct);
 * a hand-written `.env.local` may use `DATABASE_URL` / `DATABASE_URL_UNPOOLED`.
 */
export function pooledDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
}

export function directDatabaseUrl(): string | undefined {
  return (
    process.env.DATABASE_URL_UNPOOLED ??
    process.env.POSTGRES_URL_NON_POOLING ??
    pooledDatabaseUrl()
  );
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
