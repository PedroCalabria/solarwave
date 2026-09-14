import { isNull, and, eq, inArray, isNotNull, lt, ne, or, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../client";
import { callAttempts, leads } from "../schema";

/**
 * The periodic work (lifecycle-and-operations D7).
 *
 * All of it runs from ONE daily job, and the reason is not that Vercel Hobby
 * limits the NUMBER of cron jobs — measured, it allows 100 per project. It is
 * that Hobby limits the FREQUENCY to once a day, these four tasks want that
 * same cadence, none depends on another's result, one authenticated route is
 * one secret to hold rather than four, and the Supabase keep-alive falls out of
 * any job that touches the database at all.
 */

/**
 * Deletes transcripts past their twelve-month expiry (spec section 10).
 *
 * The attempt row, its outcome and its answers all survive: the retention rule
 * is about the conversation, not about the record that it happened. A score
 * re-computation still works afterwards because it reads the stored answers,
 * never the transcript.
 *
 * An attempt with no expiry recorded is left alone rather than treated as
 * expired — a null there means "never closed", and deleting on a null would
 * purge live calls.
 */
export async function purgeExpiredTranscripts(db: DbOrTx, now = new Date()): Promise<{ purged: number }> {
  const purged = await db
    .update(callAttempts)
    .set({ transcript: null, updatedAt: now })
    .where(
      and(
        isNotNull(callAttempts.transcriptExpiresAt),
        lt(callAttempts.transcriptExpiresAt, now),
        isNotNull(callAttempts.transcript),
      ),
    )
    .returning({ id: callAttempts.id });

  return { purged: purged.length };
}

/**
 * Attempts that closed with a transcript and whose scoring never finished.
 *
 * Today a throw inside `scoreAttempt` leaves `scoring_status` at `pending`
 * forever and the only recovery is the portal's manual button. `running` is
 * included on purpose: a function that died mid-score leaves that status set
 * with nothing left to clear it.
 */
export async function listPendingScoring(
  db: DbOrTx,
  options: { limit?: number; leadId?: string } = {},
): Promise<string[]> {
  const rows = await db
    .select({ id: callAttempts.id })
    .from(callAttempts)
    .where(
      and(
        isNotNull(callAttempts.endedAt),
        isNotNull(callAttempts.transcript),
        inArray(callAttempts.scoringStatus, ["pending", "running", "failed"]),
        ...(options.leadId ? [eq(callAttempts.leadId, options.leadId)] : []),
      ),
    )
    .limit(options.limit ?? 25);

  return rows.map((r) => r.id);
}

/**
 * Leads whose scheduled call time passed by more than a margin
 * (design D7 step 4, and the degradation ladder in D11).
 *
 * The margin is what keeps this from racing the durable run: an hour is far
 * longer than a healthy run needs to wake and dial, so the sweep only ever sees
 * leads the scheduler genuinely missed. Losing the race anyway is harmless —
 * `createDispatchedAttempt` refuses a second in-flight attempt inside the
 * transaction that reserves the first.
 *
 * Terminal leads are excluded here as well as downstream. An opted-out lead
 * carrying a stale `next_call_at` must never even be offered to dispatch: spec
 * section 6, and a scheduler is where it is easiest to break by accident.
 */
export async function listOverdueLeads(
  db: DbOrTx,
  options: { now?: Date; marginMs?: number; limit?: number } = {},
): Promise<string[]> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - (options.marginMs ?? 60 * 60 * 1000));

  const rows = await db
    .select({ id: leads.id })
    .from(leads)
    .where(
      and(
        isNotNull(leads.nextCallAt),
        lt(leads.nextCallAt, cutoff),
        inArray(leads.status, ["new", "waiting_retry"]),
        isNull(leads.optOutAt),
      ),
    )
    .limit(options.limit ?? 25);

  return rows.map((r) => r.id);
}

/**
 * Touches the database so a free-tier project does not suspend for inactivity.
 *
 * There is no separate keep-alive job: a daily run that reads and writes IS the
 * keep-alive. This exists so the guarantee holds even on a day when every other
 * task finds nothing to do.
 */
export async function keepAlivePing(db: Db): Promise<{ at: Date }> {
  const rows = (await db.execute(sql`select now() as at`)) as unknown as { at: unknown }[];
  // MEASURED: the driver hands `now()` back as a string, not a Date, and
  // calling `toISOString()` on it threw — which the maintenance runner dutifully
  // reported as a FAILED keep-alive on a database it had just reached. Coerce.
  const raw = rows[0]?.at;
  const at = raw instanceof Date ? raw : new Date(String(raw ?? ""));
  return { at: Number.isNaN(at.getTime()) ? new Date() : at };
}

/** Attempts whose transcript is still inside retention, for reporting. */
export async function countLiveTranscripts(db: DbOrTx): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(callAttempts)
    .where(and(isNotNull(callAttempts.transcript), or(isNull(callAttempts.outcome), ne(callAttempts.outcome, "failed"))));
  return Number(row?.n ?? 0);
}
