import type { AttemptOutcome } from "@solarwave/core";

/**
 * Twilio's view of how a call went, translated into ours (design D9).
 *
 * Pure, so the whole table is testable without a telephone. It is deliberately
 * separate from the session's end reason: the session says what the CONVERSATION
 * did, this says what the LINE did, and the completion path prefers the former
 * only when the call was actually answered by a human.
 */

/** `CallStatus` on the status callback. */
export type TwilioCallStatus =
  | "queued"
  | "initiated"
  | "ringing"
  | "in-progress"
  | "completed"
  | "busy"
  | "failed"
  | "no-answer"
  | "canceled";

/** `AnsweredBy`, present only when machine detection ran. */
export type TwilioAnsweredBy =
  | "human"
  | "machine_start"
  | "machine_end_beep"
  | "machine_end_silence"
  | "machine_end_other"
  | "fax"
  | "unknown";

const MACHINE: ReadonlySet<string> = new Set([
  "machine_start",
  "machine_end_beep",
  "machine_end_silence",
  "machine_end_other",
  "fax",
]);

export type ResolveOutcomeInput = {
  status: TwilioCallStatus | string;
  answeredBy?: TwilioAnsweredBy | string | null;
  /** What the conversation resolved, when a session ran at all. */
  sessionOutcome?: AttemptOutcome | null;
};

/** Whether Twilio's answering-machine detection says a machine picked up. */
export function isMachine(answeredBy: string | null | undefined): boolean {
  return answeredBy !== null && answeredBy !== undefined && MACHINE.has(answeredBy);
}

/**
 * The attempt outcome for a finished call.
 *
 * A detected machine wins over anything the session thought, because whatever
 * conversation happened was with an answering machine. `unknown` detection is
 * treated as a human on purpose: hanging up on a real person the detector was
 * unsure about is the worse error, and the retry policy already absorbs a call
 * that produced nothing.
 *
 * An answered call with no session outcome — the bridge never connected, or
 * died before resolving one — is `answered_incomplete`, which the lifecycle
 * already retries like a no-answer (spec section 4.5).
 */
export function resolveAttemptOutcome({ status, answeredBy, sessionOutcome }: ResolveOutcomeInput): AttemptOutcome {
  if (isMachine(answeredBy)) return "voicemail";

  switch (status) {
    case "busy":
      return "busy";
    case "no-answer":
      return "no_answer";
    case "canceled":
    case "failed":
      return "failed";
    case "completed":
      return sessionOutcome ?? "answered_incomplete";
    default:
      // A terminal callback should not carry a non-terminal status, but if one
      // does, treating it as a failed attempt keeps the lead retryable rather
      // than stuck in `calling`.
      return sessionOutcome ?? "failed";
  }
}
