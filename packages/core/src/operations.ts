/**
 * The operational envelope around placing calls (lifecycle-and-operations D4
 * and D5).
 *
 * Pure and I/O-free, like everything else in this package. Persistence lives in
 * `@solarwave/db`; the arithmetic that decides whether one more call fits lives
 * here so it can be unit-tested without a database.
 */

export type OperationsSettings = {
  /** Gates the durable run only. An administrator is never refused for this. */
  autoDispatchEnabled: boolean;
  /** Calls permitted in a rolling day, counted against EVERY dispatch. */
  dailyCallBudget: number;
  /** Telephony seconds permitted in a rolling month, against every dispatch. */
  monthlyVoiceSecondsBudget: number;
};

/**
 * Off, and deliberately so. Deploying the scheduler must not start placing
 * calls; enabling it is an audited act with an employee's name on it.
 *
 * The two budgets are sized from the Twilio trial the demo runs on: 75 free
 * voice minutes over thirty days, which is 4500 seconds and roughly 35
 * two-minute calls in total. The monthly figure is therefore the real ceiling.
 * The daily figure guards a different failure — a loop burning the whole
 * allowance in an hour — and 10 is chosen because the seeded demo could
 * otherwise produce 54 calls (18 leads at the 3-attempt cap) unattended.
 */
export const DEFAULT_OPERATIONS_SETTINGS: OperationsSettings = {
  autoDispatchEnabled: false,
  dailyCallBudget: 10,
  monthlyVoiceSecondsBudget: 75 * 60,
};

/** Rolling windows the budgets are measured over. */
export const DAILY_BUDGET_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MONTHLY_BUDGET_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type BudgetConsumption = {
  /** Calls placed within the daily window. */
  callsToday: number;
  /** Telephony seconds recorded within the monthly window. */
  voiceSecondsThisMonth: number;
};

export type BudgetVerdict =
  | { fits: true }
  | { fits: false; budget: "daily_calls" | "monthly_voice_seconds"; used: number; limit: number };

/**
 * Does one more call fit?
 *
 * At the limit is NOT allowed: a budget of one means one call, so a consumption
 * already equal to the budget refuses. A budget of zero refuses everything,
 * which is the honest reading of "no calls" and the reason this is a `>=` and
 * not a `>`.
 *
 * Seconds are checked against what PREVIOUS calls consumed, because the cost of
 * the call being decided is unknowable until it ends. The monthly budget is
 * therefore a ceiling that can be crossed by at most one call's worth — sized
 * for it, and stated here rather than discovered later.
 */
export function budgetAllows(consumption: BudgetConsumption, settings: OperationsSettings): BudgetVerdict {
  if (consumption.callsToday >= settings.dailyCallBudget) {
    return {
      fits: false,
      budget: "daily_calls",
      used: consumption.callsToday,
      limit: settings.dailyCallBudget,
    };
  }
  if (consumption.voiceSecondsThisMonth >= settings.monthlyVoiceSecondsBudget) {
    return {
      fits: false,
      budget: "monthly_voice_seconds",
      used: consumption.voiceSecondsThisMonth,
      limit: settings.monthlyVoiceSecondsBudget,
    };
  }
  return { fits: true };
}

/** Start of the rolling daily window, for the query that counts against it. */
export function dailyWindowStart(now: Date): Date {
  return new Date(now.getTime() - DAILY_BUDGET_WINDOW_MS);
}

/** Start of the rolling monthly window. */
export function monthlyWindowStart(now: Date): Date {
  return new Date(now.getTime() - MONTHLY_BUDGET_WINDOW_MS);
}
