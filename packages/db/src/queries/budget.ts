import {
  dailyWindowStart,
  monthlyWindowStart,
  type BudgetConsumption,
} from "@solarwave/core";
import { and, count, gte, isNull, ne, or, sql } from "drizzle-orm";
import type { DbOrTx } from "../client";
import { callAttempts } from "../schema";
import { SIMULATED_REASON } from "./attempts";

/**
 * What the dispatch budgets are measured against (lifecycle-and-operations D5).
 *
 * A SIMULATED attempt is excluded from both figures. It places no telephone
 * call and opens no realtime session, so counting it would let the demo's own
 * safety valve — running the pipeline end to end for free — exhaust the budget
 * that exists to protect the metered path. Simulated attempts are marked by
 * `ended_reason = 'simulated'` with a null call SID, per `attempts.ts`.
 */
const notSimulated = or(isNull(callAttempts.endedReason), ne(callAttempts.endedReason, SIMULATED_REASON));

export async function getBudgetConsumption(db: DbOrTx, now = new Date()): Promise<BudgetConsumption> {
  const [calls] = await db
    .select({ n: count() })
    .from(callAttempts)
    .where(and(gte(callAttempts.startedAt, dailyWindowStart(now)), notSimulated));

  const [seconds] = await db
    .select({ total: sql<number>`coalesce(sum(${callAttempts.telephonySeconds}), 0)` })
    .from(callAttempts)
    .where(and(gte(callAttempts.startedAt, monthlyWindowStart(now)), notSimulated));

  return {
    // Counts DISPATCHED attempts, not connected ones. A dispatch that the
    // provider rejects spends no minutes but does consume an attempt, and a
    // loop failing that way is exactly the runaway the daily budget exists to
    // stop — so it counts.
    callsToday: Number(calls?.n ?? 0),
    // Sums only what calls actually consumed: `telephony_seconds` is null until
    // an attempt closes with a duration the provider reported.
    voiceSecondsThisMonth: Number(seconds?.total ?? 0),
  };
}
