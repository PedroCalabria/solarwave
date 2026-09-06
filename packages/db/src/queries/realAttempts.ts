import { MAX_ATTEMPTS, isTerminal, transition, type AttemptOutcome, type QualificationDecision } from "@solarwave/core";
import { and, desc, eq, isNull, lt } from "drizzle-orm";
import type { Db, DbOrTx } from "../client";
import { callAttempts, guardrailViolations, leads, type CallAttempt, type Lead, type TranscriptTurn } from "../schema";

/**
 * Persistence for a REAL telephone attempt (voice-bridge design D6).
 *
 * A simulated call writes one complete row: the conversation is over before
 * anything is stored. A telephone call cannot work that way. The row has to
 * exist before the result arrives, because the provider's status callback and
 * the media socket are separate requests in separate function instances, and
 * `twilio_call_sid` is the only thing that connects them to the lead.
 *
 * So: create, then complete. No migration — every column already exists, and
 * `twilio_call_sid` already carries the unique index that makes completion
 * idempotent under Twilio's retries.
 */

/** Twelve months from the call (spec section 10). */
const TRANSCRIPT_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * How long past the hard stop an open attempt is still believed.
 *
 * Generous on purpose: reconciliation exists for the callback that never
 * arrives, not for the one that is thirty seconds late, and closing a call
 * that is still talking would be a worse bug than the one being fixed.
 */
export const STALE_ATTEMPT_MARGIN_MS = 5 * 60 * 1000;

export type DispatchRefusal =
  | "lead_not_found"
  | "opted_out"
  | "attempt_in_flight"
  | "attempt_cap_reached"
  | "blocked_by_violation";

export type CreateDispatchedAttemptResult =
  | { ok: true; attempt: CallAttempt; attemptNumber: number; lead: Lead }
  | { ok: false; reason: DispatchRefusal };

/**
 * Reserves the attempt a call is about to produce, and moves the lead to
 * `calling` — both inside one transaction with the lead row locked.
 *
 * The refusals live HERE rather than in the caller because the caller's checks
 * are a race, and this race places a telephone call that cannot be recalled.
 * The window between "we read the lead" and "we dialled" is small, and small
 * is not zero.
 *
 * The Twilio SID is not known yet: it comes back from `calls.create`. The row
 * is written first anyway, so a call that connects before the API response is
 * processed still finds an attempt to attach itself to.
 */
export async function createDispatchedAttempt(
  db: Db,
  input: { leadId: string; scheduledAt?: Date; now?: Date },
): Promise<CreateDispatchedAttemptResult> {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const [lead] = await tx.select().from(leads).where(eq(leads.id, input.leadId)).for("update");
    if (!lead) return { ok: false, reason: "lead_not_found" };
    // Spec section 6: opt-out is terminal and outranks everything.
    if (lead.status === "opt_out") return { ok: false, reason: "opted_out" };

    const [inFlight] = await tx
      .select({ id: callAttempts.id })
      .from(callAttempts)
      .where(and(eq(callAttempts.leadId, input.leadId), isNull(callAttempts.endedAt)))
      .limit(1);
    if (inFlight) return { ok: false, reason: "attempt_in_flight" };

    const [last] = await tx
      .select({ attemptNumber: callAttempts.attemptNumber })
      .from(callAttempts)
      .where(eq(callAttempts.leadId, input.leadId))
      .orderBy(desc(callAttempts.attemptNumber))
      .limit(1);

    const attemptNumber = (last?.attemptNumber ?? 0) + 1;
    if (attemptNumber > MAX_ATTEMPTS) return { ok: false, reason: "attempt_cap_reached" };

    // An unreviewed high-severity violation blocks further outreach
    // (lead-lifecycle spec, scoring-worker design D8b).
    const [blocking] = await tx
      .select({ id: guardrailViolations.id })
      .from(guardrailViolations)
      .innerJoin(callAttempts, eq(guardrailViolations.callAttemptId, callAttempts.id))
      .where(
        and(
          eq(callAttempts.leadId, input.leadId),
          eq(guardrailViolations.severity, "high"),
          isNull(guardrailViolations.reviewedAt),
        ),
      )
      .limit(1);
    if (blocking) return { ok: false, reason: "blocked_by_violation" };

    const next = transition(lead.status, { type: "dispatch" });
    if (!next.ok) {
      // `calling` is the only reachable illegal source here, and it means an
      // attempt is in flight that has somehow already ended.
      return { ok: false, reason: "attempt_in_flight" };
    }

    const [attempt] = await tx
      .insert(callAttempts)
      .values({
        leadId: input.leadId,
        attemptNumber,
        scheduledAt: input.scheduledAt ?? now,
        startedAt: now,
        scoringStatus: "pending",
      })
      .returning();

    const [updated] = await tx
      .update(leads)
      .set({ status: next.value, nextCallAt: null, updatedAt: now })
      .where(eq(leads.id, input.leadId))
      .returning();

    return { ok: true, attempt: attempt!, attemptNumber, lead: updated! };
  });
}

/** Records the provider's call id, so the callback and the stream can find this row. */
export async function attachCallSid(db: DbOrTx, attemptId: string, callSid: string): Promise<void> {
  await db
    .update(callAttempts)
    .set({ twilioCallSid: callSid, updatedAt: new Date() })
    .where(eq(callAttempts.id, attemptId));
}

export async function findAttemptByCallSid(db: DbOrTx, callSid: string): Promise<CallAttempt | null> {
  const [row] = await db.select().from(callAttempts).where(eq(callAttempts.twilioCallSid, callSid)).limit(1);
  return row ?? null;
}

/**
 * Stores what the bridge has heard so far, mid-call.
 *
 * The bridge and the status callback run in different function instances with
 * no shared memory, and the bridge is the one that can die without warning
 * (design D4). Writing as it goes means a lost bridge costs a retry rather than
 * the conversation. Last write wins on one row; the caller throttles.
 */
export async function persistLiveTranscript(
  db: DbOrTx,
  attemptId: string,
  transcript: TranscriptTurn[],
): Promise<void> {
  await db.update(callAttempts).set({ transcript, updatedAt: new Date() }).where(eq(callAttempts.id, attemptId));
}

export type FinishAttemptInput = {
  attemptId: string;
  outcome: AttemptOutcome;
  endedReason?: string | null;
  transcript?: TranscriptTurn[] | null;
  endedAt?: Date;
  /** Only for `answered_complete`, and only scoring may produce one. */
  decision?: QualificationDecision;
  /** Applied when the transition schedules another attempt. */
  nextCallAt?: Date | null;
};

export type FinishAttemptResult =
  | { ok: true; attempt: CallAttempt; lead: Lead; alreadyClosed: boolean }
  | { ok: false; reason: "attempt_not_found" | "lead_not_found" | "transition_rejected"; detail?: string };

/**
 * Closes an attempt and moves the lead, once.
 *
 * Idempotent by design, not by accident: Twilio retries a status callback, and
 * a second close must not write a second transition, re-open a terminal lead or
 * run scoring twice. An attempt that already has `ended_at` returns
 * `alreadyClosed` and changes nothing.
 *
 * `answered_complete` without a decision does NOT transition the lead. Only the
 * scoring worker can say qualified or disqualified, and inventing one here
 * would put a fabricated qualification in front of a human — the thing design
 * D3 of `scoring-worker` forbids. The lead stays `calling` until the score
 * lands, which is what design D2 of that change decided.
 */
export async function finishAttempt(db: Db, input: FinishAttemptInput): Promise<FinishAttemptResult> {
  const endedAt = input.endedAt ?? new Date();

  return db.transaction(async (tx) => {
    const [attempt] = await tx
      .select()
      .from(callAttempts)
      .where(eq(callAttempts.id, input.attemptId))
      .for("update");
    if (!attempt) return { ok: false, reason: "attempt_not_found" };

    const [lead] = await tx.select().from(leads).where(eq(leads.id, attempt.leadId)).for("update");
    if (!lead) return { ok: false, reason: "lead_not_found" };

    if (attempt.endedAt) return { ok: true, attempt, lead, alreadyClosed: true };

    const [closed] = await tx
      .update(callAttempts)
      .set({
        endedAt,
        outcome: input.outcome,
        endedReason: input.endedReason ?? null,
        // A transcript is only overwritten when one is supplied: the bridge may
        // have written a better one than a callback that saw nothing.
        ...(input.transcript ? { transcript: input.transcript, transcriptExpiresAt: expiryFor(endedAt) } : {}),
        ...(attempt.transcript && !input.transcript ? { transcriptExpiresAt: expiryFor(endedAt) } : {}),
        updatedAt: endedAt,
      })
      .where(eq(callAttempts.id, input.attemptId))
      .returning();

    // Scoring applies this one itself, from the real score.
    if (input.outcome === "answered_complete" && !input.decision) {
      return { ok: true, attempt: closed!, lead, alreadyClosed: false };
    }

    const next = transition(lead.status, {
      type: "attempt_ended",
      outcome: input.outcome,
      attemptCount: attempt.attemptNumber,
      ...(input.decision ? { decision: input.decision } : {}),
    });
    if (!next.ok) {
      return { ok: false, reason: "transition_rejected", detail: next.error.code };
    }

    const set: Partial<Lead> = {
      status: next.value,
      attemptCount: attempt.attemptNumber,
      updatedAt: endedAt,
    };
    if (next.value === "opt_out") {
      set.optOutAt = endedAt;
      set.nextCallAt = null;
    } else if (isTerminal(next.value)) {
      set.nextCallAt = null;
    } else if (input.nextCallAt !== undefined) {
      set.nextCallAt = input.nextCallAt;
    }

    const [updated] = await tx.update(leads).set(set).where(eq(leads.id, attempt.leadId)).returning();
    return { ok: true, attempt: closed!, lead: updated!, alreadyClosed: false };
  });
}

/**
 * Closes attempts the status callback never closed (design D6).
 *
 * The backstop for design D4's "the callback always fires". Over a demo
 * weekend on free tiers, "always" deserves one. Without it a single lost
 * callback leaves a lead in `calling` with a null `ended_at`, which every
 * future dispatch reads as a call in progress and refuses — silently, forever.
 */
export async function reconcileStaleAttempts(
  db: Db,
  options: { maxCallSeconds: number; now?: Date; marginMs?: number } = { maxCallSeconds: 180 },
): Promise<{ closed: string[] }> {
  const now = options.now ?? new Date();
  const margin = options.marginMs ?? STALE_ATTEMPT_MARGIN_MS;
  const cutoff = new Date(now.getTime() - options.maxCallSeconds * 1000 - margin);

  const stale = await db
    .select({ id: callAttempts.id })
    .from(callAttempts)
    .where(and(isNull(callAttempts.endedAt), lt(callAttempts.startedAt, cutoff)));

  const closed: string[] = [];
  for (const { id } of stale) {
    // One at a time, each in its own transaction: a lead whose transition is
    // rejected must not stop the others from being recovered.
    const result = await finishAttempt(db, {
      attemptId: id,
      outcome: "answered_incomplete",
      endedReason: "reconciled",
      endedAt: now,
    });
    if (result.ok && !result.alreadyClosed) closed.push(id);
  }
  return { closed };
}

function expiryFor(endedAt: Date): Date {
  return new Date(endedAt.getTime() + TRANSCRIPT_TTL_MS);
}

/**
 * What the bridge learned, written where the status callback can read it.
 *
 * The bridge and the callback run in different function instances with no
 * shared memory, so "the bridge publishes what it knows" (design D4) has to
 * mean a write. It sets `outcome` and `ended_reason` but deliberately NOT
 * `ended_at`: the attempt stays open, so `finishAttempt` still treats the
 * callback as the one closing it, and a bridge that dies right after this call
 * has still handed over everything it had.
 *
 * No migration: `outcome` is nullable and nothing else reads it before the
 * attempt is closed.
 */
export async function recordSessionResult(
  db: DbOrTx,
  attemptId: string,
  input: { outcome: AttemptOutcome; endedReason: string; transcript?: TranscriptTurn[] },
): Promise<void> {
  await db
    .update(callAttempts)
    .set({
      outcome: input.outcome,
      endedReason: input.endedReason,
      ...(input.transcript ? { transcript: input.transcript } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(callAttempts.id, attemptId), isNull(callAttempts.endedAt)));
}

/** One attempt by id. The webhooks resolve their token's subject through this. */
export async function getAttemptById(db: DbOrTx, attemptId: string): Promise<CallAttempt | null> {
  const [row] = await db.select().from(callAttempts).where(eq(callAttempts.id, attemptId)).limit(1);
  return row ?? null;
}
