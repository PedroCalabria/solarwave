import { addDaysLocal, nextAllowedTime } from "./window";

/** Spec section 4.5: one first call plus two retries. */
export const MAX_ATTEMPTS = 3;

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export type RetryInput = {
  /** Number of the attempt that just ended (1-based). */
  attemptNumber: number;
  /** Actual end of that attempt. Intervals are measured from here, not from the planned start. */
  endedAt: Date;
  /** IANA zone of the lead. */
  tz: string;
  /**
   * A time the lead asked to be called back at. When present it replaces the
   * interval (still pushed into the window). Used by the lifecycle change.
   */
  requestedAt?: Date;
};

/**
 * Next retry instant, or `null` when the attempts are exhausted.
 * - after attempt 1: +15 minutes
 * - after attempt 2: +2 days
 * - after attempt 3: no retry
 * The result is always inside the 08:00-22:00 window of `tz`.
 */
/**
 * How far ahead a lead-requested callback may be honoured
 * (lifecycle-and-operations D6).
 *
 * A bound exists because an LLM resolved the time from a spoken phrase. Two
 * weeks is generous for "call me after my holiday" and tight enough that a
 * misparse landing in 2027 falls back to the ordinary policy instead of
 * parking a lead for a year.
 */
export const REQUESTED_CALLBACK_HORIZON_DAYS = 14;

export type CallbackVerdict =
  | { use: true; at: Date }
  | { use: false; reason: "none" | "in_past" | "beyond_horizon" };

/**
 * Whether a resolved callback time may replace the interval policy.
 *
 * Decides only whether to USE it. The clamp into the 08:00-22:00 window is
 * `scheduleRetry`'s job, so a requested time goes through exactly the same
 * window rule as every other attempt and there is one implementation of it.
 *
 * Everything here is measured from the END of the attempt, not from now: the
 * lead said "tomorrow" during the call, and scoring may run minutes later.
 */
export function resolveRequestedCallback(input: {
  requestedAt: Date | null | undefined;
  endedAt: Date;
  horizonDays?: number;
}): CallbackVerdict {
  const { requestedAt, endedAt } = input;
  if (!requestedAt || Number.isNaN(requestedAt.getTime())) return { use: false, reason: "none" };
  if (requestedAt.getTime() <= endedAt.getTime()) return { use: false, reason: "in_past" };

  const horizonDays = input.horizonDays ?? REQUESTED_CALLBACK_HORIZON_DAYS;
  const horizon = endedAt.getTime() + horizonDays * 24 * 60 * 60 * 1000;
  if (requestedAt.getTime() > horizon) return { use: false, reason: "beyond_horizon" };

  return { use: true, at: requestedAt };
}

export function scheduleRetry({ attemptNumber, endedAt, tz, requestedAt }: RetryInput): Date | null {
  if (attemptNumber >= MAX_ATTEMPTS) return null;
  if (attemptNumber < 1) throw new RangeError("attemptNumber must be 1-based");

  if (requestedAt) return nextAllowedTime(requestedAt, tz);

  const candidate =
    attemptNumber === 1
      ? new Date(endedAt.getTime() + FIFTEEN_MINUTES_MS)
      : addDaysLocal(endedAt, 2, tz);

  return nextAllowedTime(candidate, tz);
}
