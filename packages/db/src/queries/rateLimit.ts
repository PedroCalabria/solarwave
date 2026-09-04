import { createHash } from "node:crypto";
import { lt, sql } from "drizzle-orm";
import type { DbOrTx } from "../client";
import { intakeRateLimits } from "../schema";

export const INTAKE_RATE_LIMIT = 5;
export const INTAKE_RATE_WINDOW_MS = 60_000;

/** Salted SHA-256 so raw IPs are never stored. */
export function hashIp(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

export type RateLimitResult = { allowed: boolean; count: number; resetAt: Date };

/**
 * Counts one request for `ipHash` in the current fixed window and reports
 * whether it is within the limit. Survives restarts and spans instances.
 */
export async function consumeIntakeRateLimit(
  db: DbOrTx,
  ipHash: string,
  now = new Date(),
  { limit = INTAKE_RATE_LIMIT, windowMs = INTAKE_RATE_WINDOW_MS } = {},
): Promise<RateLimitResult> {
  const windowStartMs = Math.floor(now.getTime() / windowMs) * windowMs;
  const windowStart = new Date(windowStartMs);

  const [row] = await db
    .insert(intakeRateLimits)
    .values({ ipHash, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [intakeRateLimits.ipHash, intakeRateLimits.windowStart],
      set: { count: sql`${intakeRateLimits.count} + 1` },
    })
    .returning({ count: intakeRateLimits.count });

  const count = row?.count ?? 1;
  return { allowed: count <= limit, count, resetAt: new Date(windowStartMs + windowMs) };
}

/** Housekeeping: drop windows older than `before`. */
export async function purgeIntakeRateLimits(db: DbOrTx, before: Date): Promise<void> {
  await db.delete(intakeRateLimits).where(lt(intakeRateLimits.windowStart, before));
}
