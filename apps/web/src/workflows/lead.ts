import { sleep } from "workflow";
import {
  MAX_SCORING_SETTLE_ATTEMPTS,
  callSettleSeconds,
  dispatchForRun,
  readLead,
  retryAfter,
  settleScoring,
} from "./steps";

/**
 * The durable per-lead run (lifecycle-and-operations D1, D2, D3).
 *
 * Reads the lead, sleeps until its next call time, dispatches, waits out the
 * call, reads again. No hooks: waking the instant a call ended would buy
 * nothing, because the next thing this does is sleep for at least fifteen
 * minutes — and a hook would mean editing the Twilio status callback, which is
 * the instrument `real-call-proof` still has to measure.
 *
 * It writes NO lifecycle state. The status callback says how an attempt ended,
 * scoring says whether the lead qualified, and `dispatchCall` decides whether a
 * call may be placed at all. This function only decides WHEN to ask, and
 * re-reads everything else from Postgres. Turn the flag off or delete this file
 * and the system is exactly what it was: nothing depended on the run to be
 * consistent.
 */

/** One first call plus two retries, plus headroom for refusals that clear. */
const MAX_ITERATIONS = 24;

/**
 * Refusals that waiting cannot change. Ending the run is right for each: the
 * lead is gone, has opted out, has used every attempt, or is blocked by an
 * unreviewed violation that only a person can clear.
 */
const PERMANENT = new Set(["lead_not_found", "opted_out", "attempt_cap_reached", "blocked_by_violation"]);

/**
 * How long to wait before looking again, per refusal that waiting CAN clear.
 *
 * Getting this wrong in the generous direction costs a lead one retry; getting
 * it wrong in the tight direction spins a loop against a metered account. The
 * automatic-dispatch switch gets the longest wait because it can be off for
 * days, and `retryAfter` pushes every one of these into the call window.
 */
const BACKOFF_SECONDS: Record<string, number> = {
  attempt_in_flight: 5 * 60,
  outside_call_window: 60 * 60,
  budget_exhausted: 60 * 60,
  no_active_criteria: 6 * 60 * 60,
  not_configured: 6 * 60 * 60,
  auto_dispatch_disabled: 6 * 60 * 60,
};

const DEFAULT_BACKOFF_SECONDS = 60 * 60;

export async function leadWorkflow(leadId: string) {
  "use workflow";

  let dispatched = 0;
  let waits = 0;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const lead = await readLead(leadId);

    // Re-read before every dispatch, so a lead that opted out while this run
    // was asleep is never called. Spec section 6 outranks everything else this
    // function does.
    if (!lead.found || lead.terminal) {
      return { leadId, dispatched, ended: lead.status ?? "gone" };
    }
    if (!lead.nextCallAt) {
      // Nothing scheduled: either scoring cleared it, or a guardrail did. Both
      // are decisions this run does not get to second-guess.
      return { leadId, dispatched, ended: "unscheduled" };
    }

    await sleep(lead.nextCallAt);

    // Re-read AFTER the sleep, before dispatching. `dispatchCall` refuses an
    // opted-out lead inside its own transaction anyway, so this is not the only
    // guard — but a lead that opted out while this run was asleep should be
    // recognised here, where the run can end cleanly, rather than by tripping a
    // refusal downstream. Spec section 6 is worth two guards.
    const current = await readLead(leadId);
    if (!current.found || current.terminal) {
      return { leadId, dispatched, ended: current.status ?? "gone" };
    }

    const result = await dispatchForRun(leadId);

    if (result.status === "refused") {
      if (PERMANENT.has(result.reason ?? "")) {
        return { leadId, dispatched, ended: `refused:${result.reason}` };
      }
      // Temporary, and bounded: a switch that stays off for a month must not
      // spin forever. Giving up leaves the lead to the daily sweep, which is
      // what that sweep is for.
      waits += 1;
      if (waits > MAX_ITERATIONS / 2) {
        return { leadId, dispatched, ended: `gave_up:${result.reason}` };
      }
      await sleep(await retryAfter(leadId, BACKOFF_SECONDS[result.reason ?? ""] ?? DEFAULT_BACKOFF_SECONDS));
      continue;
    }

    if (result.status === "failed") {
      // `dispatchCall` already closed the attempt and scheduled the retry, so
      // the next iteration reads a fresh `next_call_at` and needs no backoff
      // of its own.
      continue;
    }

    dispatched += 1;

    // Wait out the call rather than being told it ended (D1). The status
    // callback closes the attempt and scoring runs from it; this run only has
    // to be later than both.
    await sleep(`${await callSettleSeconds()}s`);

    if (result.attemptId) {
      for (let attempt = 0; attempt < MAX_SCORING_SETTLE_ATTEMPTS; attempt += 1) {
        const settled = await settleScoring(result.attemptId);
        if (settled.settled) break;
        // Bounded on purpose: an attempt whose scoring never lands is left to
        // the daily maintenance job rather than holding this run open.
        await sleep("60s");
      }
    }
  }

  return { leadId, dispatched, ended: "iterations_exhausted" };
}
