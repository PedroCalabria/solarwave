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
