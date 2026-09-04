import { MAX_ATTEMPTS } from "./retry";
import { err, ok, type Result } from "./result";

/** Spec section 7. */
export const LEAD_STATUSES = [
  "new",
  "calling",
  "waiting_retry",
  "no_answer_final",
  "qualified",
  "disqualified",
  "opt_out",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Spec section 8 outcome enum, extended per the project decision log. */
export const ATTEMPT_OUTCOMES = [
  "answered_complete",
  "answered_incomplete",
  "no_answer",
  "voicemail",
  "busy",
  "failed",
  "abusive",
  "minor_answered",
  "opt_out",
] as const;
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];

export type QualificationDecision = "qualified" | "disqualified";

export type LeadEvent =
  | { type: "dispatch" }
  | {
      type: "attempt_ended";
      outcome: AttemptOutcome;
      /** Total attempts made so far, including the one that just ended. */
      attemptCount: number;
      /** Required when `outcome` is `answered_complete`. */
      decision?: QualificationDecision;
    }
  | { type: "opt_out" };

export type TransitionError =
  | { code: "terminal"; status: LeadStatus }
  | { code: "illegal"; status: LeadStatus; event: LeadEvent["type"] }
  | { code: "missing_decision" };

const TERMINAL: ReadonlySet<LeadStatus> = new Set(["qualified", "disqualified", "no_answer_final", "opt_out"]);

/** Outcomes that follow the "no answer" retry path (spec section 4.5 and the decision log). */
const RETRYABLE: ReadonlySet<AttemptOutcome> = new Set([
  "no_answer",
  "voicemail",
  "busy",
  "failed",
  "answered_incomplete",
  "minor_answered",
]);

export function isTerminal(status: LeadStatus): boolean {
  return TERMINAL.has(status);
}

export function isRetryableOutcome(outcome: AttemptOutcome): boolean {
  return RETRYABLE.has(outcome);
}

/**
 * Pure transition table (design D4). Persistence applies the result under a
 * row lock; this function never touches I/O.
 */
export function transition(status: LeadStatus, event: LeadEvent): Result<LeadStatus, TransitionError> {
  if (isTerminal(status)) return err({ code: "terminal", status });

  if (event.type === "opt_out") return ok("opt_out");

  if (event.type === "dispatch") {
    if (status === "new" || status === "waiting_retry") return ok("calling");
    return err({ code: "illegal", status, event: event.type });
  }

  // attempt_ended
  if (status !== "calling") return err({ code: "illegal", status, event: event.type });

  switch (event.outcome) {
    case "opt_out":
      return ok("opt_out");
    case "abusive":
      return ok("disqualified");
    case "answered_complete":
      if (!event.decision) return err({ code: "missing_decision" });
      return ok(event.decision);
    default:
      if (isRetryableOutcome(event.outcome)) {
        return ok(event.attemptCount >= MAX_ATTEMPTS ? "no_answer_final" : "waiting_retry");
      }
      return err({ code: "illegal", status, event: event.type });
  }
}
