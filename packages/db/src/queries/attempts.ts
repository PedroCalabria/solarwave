import { isTerminal, transition, type AttemptOutcome, type LeadEvent, type TransitionError } from "@solarwave/core";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db, DbOrTx } from "../client";
import {
  callAttempts,
  guardrailViolations,
  leads,
  notDeleted,
  qualificationAnswers,
  qualificationCriteria,
  type CallAttempt,
  type Criterion,
  type Lead,
  type ScoringStatus,
  type TranscriptTurn,
} from "../schema";

export type AttemptForScoring = {
  attempt: CallAttempt;
  lead: Lead;
  criteria: Criterion[];
  /** True when the lead opted out or an unreviewed high-severity violation stands. */
  suppressOutreach: boolean;
};

/** Everything the worker needs in one read: attempt, lead and the live criteria. */
export async function loadAttemptForScoring(db: DbOrTx, attemptId: string): Promise<AttemptForScoring | null> {
  const [row] = await db
    .select({ attempt: callAttempts, lead: leads })
    .from(callAttempts)
    .innerJoin(leads, eq(callAttempts.leadId, leads.id))
    .where(eq(callAttempts.id, attemptId))
    .limit(1);
  if (!row) return null;

  const criteria = await db
    .select()
    .from(qualificationCriteria)
    .where(notDeleted)
    .orderBy(qualificationCriteria.sortOrder);

  const [blocking] = await db
    .select({ id: guardrailViolations.id })
    .from(guardrailViolations)
    .where(
      and(
        eq(guardrailViolations.callAttemptId, attemptId),
        eq(guardrailViolations.severity, "high"),
        isNull(guardrailViolations.reviewedAt),
      ),
    )
    .limit(1);

  return {
    attempt: row.attempt,
    lead: row.lead,
    criteria,
    suppressOutreach: row.lead.status === "opt_out" || Boolean(blocking),
  };
}

export async function setScoringStatus(db: DbOrTx, attemptId: string, status: ScoringStatus): Promise<void> {
  await db
    .update(callAttempts)
    .set({ scoringStatus: status, updatedAt: new Date() })
    .where(eq(callAttempts.id, attemptId));
}

export type AnswerRow = {
  criteriaId: string;
  extractedValue: string | null;
  normalizedValue: unknown;
  confidence: number;
  evidence: string | null;
  passed: boolean | null;
};

export type SaveScoringInput = {
  attemptId: string;
  leadId: string;
  answers: AnswerRow[];
  score: number;
  reason: string;
  icebreaker: string | null;
  /** Applied under the row lock. Omitted when re-scoring a lead that already moved. */
  event?: LeadEvent;
};

export type SaveScoringResult =
  | { ok: true; lead: Lead; scoredAt: Date }
  | { ok: false; error: TransitionError | { code: "not_found" } };

/**
 * Writes answers, score, narrative and `scored_at` in a single transaction
 * (design D6). Answers are upserted on `unique(call_attempt_id, criteria_id)`,
 * never appended, so a retried run cannot mix two executions.
 *
 * When an `event` is given the lead row is locked first and the transition is
 * computed by the pure table, so a concurrent opt-out cannot be overwritten.
 */
export async function saveScoringResult(db: Db, input: SaveScoringInput): Promise<SaveScoringResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(leads).where(eq(leads.id, input.leadId)).for("update");
    if (!current) return { ok: false, error: { code: "not_found" } };

    let nextStatus = current.status;
    if (input.event) {
      const next = transition(current.status, input.event);
      if (!next.ok) return { ok: false, error: next.error };
      nextStatus = next.value;
    }

    const now = new Date();

    for (const answer of input.answers) {
      await tx
        .insert(qualificationAnswers)
        .values({
          callAttemptId: input.attemptId,
          criteriaId: answer.criteriaId,
          extractedValue: answer.extractedValue,
          normalizedValue: answer.normalizedValue,
          confidence: String(answer.confidence),
          evidence: answer.evidence,
          passed: answer.passed,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [qualificationAnswers.callAttemptId, qualificationAnswers.criteriaId],
          set: {
            extractedValue: answer.extractedValue,
            normalizedValue: answer.normalizedValue,
            confidence: String(answer.confidence),
            evidence: answer.evidence,
            passed: answer.passed,
            updatedAt: now,
          },
        });
    }

    // Criteria that no longer exist in this run must not leave a stale answer.
    const keptIds = new Set(input.answers.map((a) => a.criteriaId));
    const existing = await tx
      .select({ id: qualificationAnswers.id, criteriaId: qualificationAnswers.criteriaId })
      .from(qualificationAnswers)
      .where(eq(qualificationAnswers.callAttemptId, input.attemptId));
    for (const row of existing) {
      if (!keptIds.has(row.criteriaId)) {
        await tx.delete(qualificationAnswers).where(eq(qualificationAnswers.id, row.id));
      }
    }

    await tx
      .update(callAttempts)
      .set({ scoringStatus: "done", scoredAt: now, updatedAt: now })
      .where(eq(callAttempts.id, input.attemptId));

    const leadPatch: Partial<Lead> = {
      score: input.score,
      qualificationReason: input.reason,
      icebreaker: input.icebreaker,
      status: nextStatus,
      updatedAt: now,
    };
    if (input.event?.type === "attempt_ended") leadPatch.attemptCount = input.event.attemptCount;
    if (nextStatus === "opt_out") {
      leadPatch.optOutAt = now;
      leadPatch.nextCallAt = null;
    } else if (isTerminal(nextStatus)) {
      leadPatch.nextCallAt = null;
    }

    const [updated] = await tx.update(leads).set(leadPatch).where(eq(leads.id, input.leadId)).returning();
    return { ok: true, lead: updated!, scoredAt: now };
  });
}

/**
 * Stops further outreach without touching the lead's status. Used when the
 * judge finds opt-out intent the live agent missed: the terminal `opt_out`
 * status is never written from a model finding (design D8b).
 */
export async function clearNextCall(db: DbOrTx, leadId: string): Promise<void> {
  await db.update(leads).set({ nextCallAt: null, updatedAt: new Date() }).where(eq(leads.id, leadId));
}

export type StoredAnswer = { criterionKey: string; value: unknown; criteriaId: string };

/**
 * The answers a score was computed from. A pure re-score reads these and never
 * touches the transcript, which is why it still works after the twelve-month
 * retention has purged it.
 */
export async function loadStoredAnswers(db: DbOrTx, attemptId: string): Promise<StoredAnswer[]> {
  return db
    .select({
      criterionKey: qualificationCriteria.key,
      value: qualificationAnswers.normalizedValue,
      criteriaId: qualificationAnswers.criteriaId,
    })
    .from(qualificationAnswers)
    .innerJoin(qualificationCriteria, eq(qualificationAnswers.criteriaId, qualificationCriteria.id))
    .where(eq(qualificationAnswers.callAttemptId, attemptId));
}

/**
 * The stored answers as writable rows, so a re-score can re-evaluate verdicts
 * while preserving the confidence and evidence the extraction produced.
 */
export async function loadAnswerRows(db: DbOrTx, attemptId: string): Promise<(AnswerRow & { criterionKey: string })[]> {
  const rows = await db
    .select({ answer: qualificationAnswers, criterionKey: qualificationCriteria.key })
    .from(qualificationAnswers)
    .innerJoin(qualificationCriteria, eq(qualificationAnswers.criteriaId, qualificationCriteria.id))
    .where(eq(qualificationAnswers.callAttemptId, attemptId));

  return rows.map((r) => ({
    criteriaId: r.answer.criteriaId,
    criterionKey: r.criterionKey,
    extractedValue: r.answer.extractedValue,
    normalizedValue: r.answer.normalizedValue,
    confidence: r.answer.confidence === null ? 0 : Number(r.answer.confidence),
    evidence: r.answer.evidence,
    passed: r.answer.passed,
  }));
}

export type ScoringPending = {
  attemptId: string;
  attemptNumber: number;
  leadId: string;
  leadName: string;
  endedAt: Date | null;
};

/** Attempts whose scoring failed, for the portal's pendings list. */
export async function listScoringPendings(db: DbOrTx, limit = 50): Promise<ScoringPending[]> {
  const rows = await db
    .select({
      attemptId: callAttempts.id,
      attemptNumber: callAttempts.attemptNumber,
      leadId: leads.id,
      leadName: leads.name,
      endedAt: callAttempts.endedAt,
    })
    .from(callAttempts)
    .innerJoin(leads, eq(callAttempts.leadId, leads.id))
    .where(eq(callAttempts.scoringStatus, "failed"))
    .orderBy(desc(callAttempts.endedAt))
    .limit(limit);
  return rows;
}

/** The attempt whose answers back the lead's current score. */
export async function latestScoredAttempt(db: DbOrTx, leadId: string): Promise<CallAttempt | null> {
  const [row] = await db
    .select()
    .from(callAttempts)
    .where(and(eq(callAttempts.leadId, leadId), isNotNull(callAttempts.scoredAt)))
    .orderBy(desc(callAttempts.scoredAt))
    .limit(1);
  return row ?? null;
}

/** Whether the transcript is still available to reprocess (spec section 10). */
export function transcriptAvailable(attempt: CallAttempt, now = new Date()): boolean {
  const turns = attempt.transcript as TranscriptTurn[] | null;
  if (!turns || turns.length === 0) return false;
  return !attempt.transcriptExpiresAt || attempt.transcriptExpiresAt > now;
}

/** Marks an attempt as produced by the text harness rather than by a phone call. */
export const SIMULATED_REASON = "simulated";

export type SimulatedAttemptInput = {
  leadId: string;
  transcript: TranscriptTurn[];
  startedAt: Date;
  endedAt: Date;
  outcome: AttemptOutcome;
};

export type CreateSimulatedAttemptResult =
  | { ok: true; attempt: CallAttempt; attemptNumber: number }
  | { ok: false; reason: "lead_not_found" | "opted_out" | "attempt_in_flight" };

/**
 * Creates a simulated attempt (design D9).
 *
 * Marking it needs no schema change: `ended_reason = 'simulated'` with a null
 * `twilio_call_sid`, which the unique index admits many of. A dedicated
 * `simulated` boolean was rejected — `ended_reason` is already the column that
 * describes how an attempt ended, and this is precisely that.
 *
 * The two refusals are enforced here, inside the transaction that reads the
 * lead, rather than in the caller: `opt_out` is terminal and highest-priority
 * in spec section 6, so simulating contact with someone who asked not to be
 * contacted is refused even in a demo, and a lead may only have one attempt in
 * flight at a time.
 */
export async function createSimulatedAttempt(
  db: Db,
  input: SimulatedAttemptInput,
): Promise<CreateSimulatedAttemptResult> {
  return db.transaction(async (tx) => {
    const [lead] = await tx.select().from(leads).where(eq(leads.id, input.leadId)).for("update");
    if (!lead) return { ok: false, reason: "lead_not_found" };
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
    const [attempt] = await tx
      .insert(callAttempts)
      .values({
        leadId: input.leadId,
        attemptNumber,
        scheduledAt: input.startedAt,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        outcome: input.outcome,
        endedReason: SIMULATED_REASON,
        transcript: input.transcript,
        // Spec section 10: twelve months from the call, purged by the cron.
        transcriptExpiresAt: new Date(input.endedAt.getTime() + 365 * 24 * 60 * 60 * 1000),
        scoringStatus: "pending",
      })
      .returning();

    return { ok: true, attempt: attempt!, attemptNumber };
  });
}

/** Whether an attempt came from the text harness. */
export function isSimulated(attempt: Pick<CallAttempt, "endedReason">): boolean {
  return attempt.endedReason === SIMULATED_REASON;
}
