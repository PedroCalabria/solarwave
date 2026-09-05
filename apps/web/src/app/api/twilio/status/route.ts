import { scheduleRetry } from "@solarwave/core";
import { finishAttempt, getDb, getLeadById } from "@solarwave/db";
import { resolveAttemptOutcome } from "@solarwave/voice";
import { scoreAttempt } from "@solarwave/scoring";
import { scoringDeps } from "@/lib/scoring";
import { verifyTwilioWebhook } from "@/lib/voice";

/**
 * The authority on how an attempt ended (design D4).
 *
 * The media bridge is best-effort: it dies with its function instance, at the
 * duration limit, on a redeploy, on any uncaught error. This callback fires for
 * every call, including one whose media stream never opened, so it is what
 * closes the attempt, applies the transition and hands the work to scoring.
 *
 * Idempotent throughout, because Twilio retries.
 */
export async function POST(request: Request) {
  const verified = await verifyTwilioWebhook(request);
  if (!verified.ok) {
    return Response.json({ error: verified.error.message }, { status: verified.error.status });
  }

  const { params, attempt } = verified.value;
  const status = params.CallStatus ?? "";

  // Asynchronous machine detection posts here too, before the call completes.
  // Acknowledge it without closing anything: the completed event does that, and
  // it carries `AnsweredBy` as well.
  if (status !== "completed" && !TERMINAL.has(status)) {
    return Response.json({ ok: true, ignored: status || "(no status)" });
  }

  const db = getDb();
  const outcome = resolveAttemptOutcome({
    status,
    answeredBy: params.AnsweredBy ?? null,
    // The bridge wrote what the conversation resolved, leaving the attempt open.
    sessionOutcome: attempt.outcome,
  });

  const lead = await getLeadById(db, attempt.leadId);
  const retry = lead
    ? scheduleRetry({ attemptNumber: attempt.attemptNumber, endedAt: new Date(), tz: lead.timezone })
    : null;

  const closed = await finishAttempt(db, {
    attemptId: attempt.id,
    outcome,
    endedReason: attempt.endedReason ?? status,
    ...(retry ? { nextCallAt: retry } : {}),
  });

  if (!closed.ok) {
    return Response.json({ error: closed.reason, detail: closed.detail }, { status: 409 });
  }
  if (closed.alreadyClosed) {
    // Twilio retried. One close, one transition, one scoring run.
    return Response.json({ ok: true, alreadyClosed: true, outcome: closed.attempt.outcome });
  }

  // Only a call that produced a transcript is worth scoring. Everything else —
  // busy, no answer, voicemail — has nothing to extract from.
  const transcript = closed.attempt.transcript;
  if (!transcript || transcript.length === 0) {
    return Response.json({ ok: true, outcome, scored: false });
  }

  const scored = await scoreAttempt(scoringDeps(), attempt.id);
  return Response.json({ ok: true, outcome, scored: scored.status === "done", scoring: scored.status });
}

/** Statuses that end a call. `completed` is handled alongside them. */
const TERMINAL = new Set(["completed", "busy", "failed", "no-answer", "canceled"]);
