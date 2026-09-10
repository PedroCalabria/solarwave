import { isTerminal, nextAllowedTime, type LeadStatus } from "@solarwave/core";
import { getAttemptById, getDb, getLeadById } from "@solarwave/db";
import { scoreAttempt } from "@solarwave/scoring";
import { dispatchCall } from "@solarwave/voice/dispatch";
import { scoringDeps } from "@/lib/scoring";

/**
 * Everything `leadWorkflow` is allowed to touch (lifecycle-and-operations D2).
 *
 * A `"use workflow"` function runs in a sandboxed VM with no Node built-ins, and
 * `@solarwave/db` is the postgres driver, so every read, every write and every
 * call to `dispatchCall` lives here behind `"use step"`. Two consequences that
 * are not merely bookkeeping:
 *
 * - Steps are ordinary async functions. The existing PGlite harness exercises
 *   them directly, and only the orchestration needs the SDK's test plugin.
 * - MEASURED (spike 1.2): the workflow builder bundles this file with esbuild
 *   from `apps/web`, so a step may only import what `apps/web` itself depends
 *   on. Reaching for `drizzle-orm` here does not resolve under pnpm's strict
 *   node_modules — every query goes through the `@solarwave/db` barrel.
 *
 * Everything returned from a step must be serializable, so these hand back
 * plain objects and Dates rather than database rows.
 */

/** How long past the hard stop the run waits before believing a call is over. */
const CALL_SETTLE_MARGIN_SECONDS = 60;

/** Bounded, because a scoring run that never lands must not hold a lead's run open. */
export const MAX_SCORING_SETTLE_ATTEMPTS = 3;

export type LeadSnapshot = {
  found: boolean;
  status: LeadStatus | null;
  terminal: boolean;
  nextCallAt: Date | null;
  attemptCount: number;
  timezone: string;
};

/** The lead as the run needs to see it: status, schedule, nothing else. */
export async function readLead(leadId: string): Promise<LeadSnapshot> {
  "use step";

  const lead = await getLeadById(getDb(), leadId);
  if (!lead) {
    return { found: false, status: null, terminal: true, nextCallAt: null, attemptCount: 0, timezone: "UTC" };
  }
  return {
    found: true,
    status: lead.status,
    terminal: isTerminal(lead.status),
    nextCallAt: lead.nextCallAt,
    attemptCount: lead.attemptCount,
    timezone: lead.timezone,
  };
}

export type DispatchStepResult = {
  status: "dispatched" | "refused" | "failed";
  reason: string | null;
  attemptId: string | null;
};

/**
 * Places the call, through the SAME `dispatchCall` an administrator uses.
 *
 * `origin: "run"` is the only difference, and it exists for one rule: the
 * automatic dispatch switch gates the scheduler and never a person (D4). Every
 * other refusal — opt-out, in flight, the attempt cap, the call window, an
 * unreviewed violation, both budgets — is enforced inside the transaction that
 * reserves the attempt, exactly as it is for the portal button.
 */
export async function dispatchForRun(leadId: string): Promise<DispatchStepResult> {
  "use step";

  const result = await dispatchCall({ db: getDb(), leadId, origin: "run" });
  if (result.status === "dispatched") {
    return { status: "dispatched", reason: null, attemptId: result.attempt.id };
  }
  if (result.status === "refused") {
    return { status: "refused", reason: result.reason, attemptId: null };
  }
  return { status: "failed", reason: result.message, attemptId: null };
}

/**
 * Re-drives scoring for an attempt that closed with a transcript and never
 * finished (D8).
 *
 * Not a new authority: `scoreAttempt` remains the only thing that scores. This
 * only calls it again, because a run that read the lead before scoring landed
 * would see `calling` and draw the wrong conclusion.
 */
export async function settleScoring(attemptId: string): Promise<{ settled: boolean }> {
  "use step";

  const db = getDb();
  const attempt = await getAttemptById(db, attemptId);
  if (!attempt) return { settled: true };

  // Nothing to settle: still open, or closed with nothing to extract from.
  if (!attempt.endedAt) return { settled: false };
  if (!attempt.transcript || attempt.transcript.length === 0) return { settled: true };
  if (attempt.scoringStatus === "done") return { settled: true };

  const scored = await scoreAttempt(scoringDeps(), attemptId);
  return { settled: scored.status === "done" };
}

/** How long to wait out a call before reading the lead again. */
export async function callSettleSeconds(): Promise<number> {
  "use step";

  const max = Number(process.env.VOICE_MAX_CALL_SECONDS ?? 180);
  return (Number.isFinite(max) && max > 0 ? max : 180) + CALL_SETTLE_MARGIN_SECONDS;
}

/**
 * When to look again after a refusal that waiting can clear.
 *
 * Pushed into the lead's 08:00-22:00 window, so a run that backs off never
 * wakes to dial at three in the morning — and never busy-loops on a
 * `next_call_at` that is already in the past, which is what a naive re-read
 * would do.
 */
export async function retryAfter(leadId: string, backoffSeconds: number): Promise<Date> {
  "use step";

  const lead = await getLeadById(getDb(), leadId);
  const candidate = new Date(Date.now() + backoffSeconds * 1000);
  return lead ? nextAllowedTime(candidate, lead.timezone) : candidate;
}
