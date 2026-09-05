import type { LanguageModel } from "@solarwave/ai";
import { scheduleRetry, type AttemptOutcome } from "@solarwave/core";
import {
  applyLeadTransition,
  createSimulatedAttempt,
  getLeadById,
  listActiveCriteria,
  type Db,
  type Lead,
} from "@solarwave/db";
import type { TranscriptTurn } from "@solarwave/scoring";
import type { ScriptCriterion } from "./criteria";
import { runConversation, type ConversationResult, type Responder } from "./loop";

export type SimulateRefusal =
  | "lead_not_found"
  | "opted_out"
  | "attempt_in_flight"
  | "no_active_criteria";

export type SimulateOutcome =
  | {
      status: "done";
      attemptId: string;
      attemptNumber: number;
      lead: Lead;
      outcome: AttemptOutcome;
      transcript: TranscriptTurn[];
      conversation: ConversationResult;
    }
  | { status: "refused"; reason: SimulateRefusal }
  | { status: "failed"; message: string };

export type SimulateCallInput = {
  db: Db;
  leadId: string;
  model: LanguageModel;
  respond: Responder;
  maxTurns?: number;
  now?: Date;
};

function toScriptCriteria(rows: Awaited<ReturnType<typeof listActiveCriteria>>): ScriptCriterion[] {
  return rows.map((c) => ({
    key: c.key,
    label: c.label,
    questionPt: c.questionPt,
    questionEn: c.questionEn,
    type: c.type,
    options: c.options,
    expectedValue: c.expectedValue,
    weight: c.weight,
    blocking: c.blocking,
    active: c.active,
    sortOrder: c.sortOrder,
  }));
}

/**
 * Runs a text conversation against a stored lead and persists it as a real
 * attempt (design D9).
 *
 * The attempt is real on purpose. A preview that rendered a transcript without
 * persisting it would prove the conversation and nothing else; persisting
 * proves the conversation, the extraction, the engine, the narrative, the judge
 * and the state machine together — which is the claim the demo actually makes,
 * two changes before telephony exists.
 *
 * Scoring is NOT called from here. The caller runs `scoreAttempt` afterwards,
 * exactly as change 5's workflow will, so this function stays free of the
 * scoring package's model dependencies and can be tested without them.
 */
export async function simulateCall({
  db,
  leadId,
  model,
  respond,
  maxTurns,
  now = new Date(),
}: SimulateCallInput): Promise<SimulateOutcome> {
  const lead = await getLeadById(db, leadId);
  if (!lead) return { status: "refused", reason: "lead_not_found" };
  // Checked here for a clear message, and again inside the transaction that
  // writes the attempt, which is what actually makes it safe under a race.
  if (lead.status === "opt_out") return { status: "refused", reason: "opted_out" };

  const criteria = toScriptCriteria(await listActiveCriteria(db));
  if (criteria.length === 0) return { status: "refused", reason: "no_active_criteria" };

  // `dispatch` before the call, exactly as a real attempt does. It also rejects
  // a lead that is already `calling`, which is the second refusal.
  const dispatched = await applyLeadTransition(db, leadId, { type: "dispatch" });
  if (!dispatched.ok) {
    return {
      status: "refused",
      reason: dispatched.error.code === "not_found" ? "lead_not_found" : "attempt_in_flight",
    };
  }

  const conversation = await runConversation({
    model,
    criteria,
    language: lead.preferredCallLanguage,
    respond,
    leadName: lead.name,
    maxTurns,
  });

  if (!conversation.ok) {
    // The lead is left in `calling` with no attempt row, the same place a real
    // call that never connected would leave it.
    return { status: "failed", message: conversation.error.error.message };
  }

  const ended = new Date(now.getTime() + 1);
  const created = await createSimulatedAttempt(db, {
    leadId,
    transcript: conversation.value.transcript,
    startedAt: now,
    endedAt: ended,
    outcome: conversation.value.outcome,
  });
  if (!created.ok) return { status: "refused", reason: created.reason };

  const attemptCount = created.attemptNumber;
  const outcome = conversation.value.outcome;

  /**
   * `answered_complete` is deliberately NOT transitioned here.
   *
   * That event requires a `decision`, and only scoring can produce one. The
   * scoring worker applies it itself, from the real score, in the same
   * transaction that writes the answers (`transitionEvent`). Supplying a
   * placeholder decision here would put a fabricated qualification in front of
   * a human, which is exactly what design D3 of `scoring-worker` forbids. So
   * the lead stays `calling` until the score lands — which is also what design
   * D2 of that change decided the intermediate state should be.
   */
  if (outcome === "answered_complete") {
    return {
      status: "done",
      attemptId: created.attempt.id,
      attemptNumber: attemptCount,
      lead: dispatched.lead,
      outcome,
      transcript: conversation.value.transcript,
      conversation: conversation.value,
    };
  }

  const retry = scheduleRetry({ attemptNumber: attemptCount, endedAt: ended, tz: lead.timezone });
  const applied = await applyLeadTransition(
    db,
    leadId,
    { type: "attempt_ended", outcome, attemptCount },
    // A terminal outcome has its `next_call_at` cleared by the transition
    // itself, so a retry time is only ever offered for a retryable one.
    retry ? { nextCallAt: retry } : {},
  );

  if (!applied.ok) return { status: "failed", message: `transition rejected: ${applied.error.code}` };

  return {
    status: "done",
    attemptId: created.attempt.id,
    attemptNumber: attemptCount,
    lead: applied.lead,
    outcome,
    transcript: conversation.value.transcript,
    conversation: conversation.value,
  };
}
