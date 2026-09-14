import { describe, expect, it } from "vitest";
import {
  budgetAllows,
  dailyWindowStart,
  monthlyWindowStart,
  DEFAULT_OPERATIONS_SETTINGS,
  type BudgetConsumption,
  type OperationsSettings,
} from "./operations";

const SETTINGS: OperationsSettings = {
  autoDispatchEnabled: true,
  dailyCallBudget: 3,
  monthlyVoiceSecondsBudget: 600,
};

const used = (callsToday: number, voiceSecondsThisMonth: number): BudgetConsumption => ({
  callsToday,
  voiceSecondsThisMonth,
});

describe("budgetAllows", () => {
  it("allows a call when both budgets have room", () => {
    expect(budgetAllows(used(0, 0), SETTINGS)).toEqual({ fits: true });
    expect(budgetAllows(used(2, 599), SETTINGS)).toEqual({ fits: true });
  });

  it("refuses AT the daily budget, not one past it", () => {
    // A budget of 3 means three calls: the third call is placed when two have
    // been, and the fourth is refused. Off by one here spends a real call.
    expect(budgetAllows(used(2, 0), SETTINGS)).toEqual({ fits: true });
    expect(budgetAllows(used(3, 0), SETTINGS)).toMatchObject({
      fits: false,
      budget: "daily_calls",
      used: 3,
      limit: 3,
    });
  });

  it("refuses AT the voice budget", () => {
    expect(budgetAllows(used(0, 599), SETTINGS)).toEqual({ fits: true });
    expect(budgetAllows(used(0, 600), SETTINGS)).toMatchObject({
      fits: false,
      budget: "monthly_voice_seconds",
      used: 600,
      limit: 600,
    });
  });

  it("refuses everything when a budget is zero", () => {
    expect(budgetAllows(used(0, 0), { ...SETTINGS, dailyCallBudget: 0 })).toMatchObject({
      fits: false,
      budget: "daily_calls",
    });
    expect(budgetAllows(used(0, 0), { ...SETTINGS, monthlyVoiceSecondsBudget: 0 })).toMatchObject({
      fits: false,
      budget: "monthly_voice_seconds",
    });
  });

  it("names the daily budget first when both are exhausted", () => {
    // The reported reason has to be stable, because the portal shows it and a
    // test that accepts either would not notice the message changing.
    expect(budgetAllows(used(9, 9999), SETTINGS)).toMatchObject({ fits: false, budget: "daily_calls" });
  });

  it("reports which budget was exhausted, not merely that one was", () => {
    const verdict = budgetAllows(used(0, 1000), SETTINGS);
    expect(verdict.fits).toBe(false);
    if (!verdict.fits) {
      expect(verdict.budget).toBe("monthly_voice_seconds");
      expect(verdict.used).toBe(1000);
      expect(verdict.limit).toBe(600);
    }
  });

  it("treats an empty window as full room", () => {
    expect(budgetAllows(used(0, 0), DEFAULT_OPERATIONS_SETTINGS)).toEqual({ fits: true });
  });
});

describe("the shipped defaults", () => {
  it("ships automatic dispatch OFF", () => {
    // The single most important default in this change: deploying the scheduler
    // must not start placing calls on a metered account.
    expect(DEFAULT_OPERATIONS_SETTINGS.autoDispatchEnabled).toBe(false);
  });

  it("sizes the voice budget to the Twilio trial's 75 free minutes", () => {
    expect(DEFAULT_OPERATIONS_SETTINGS.monthlyVoiceSecondsBudget).toBe(4500);
  });

  it("keeps the daily budget below what the seeded demo could spend unattended", () => {
    // 18 leads at the 3-attempt cap is 54 calls; the daily budget is the guard
    // against a loop spending them in an hour.
    expect(DEFAULT_OPERATIONS_SETTINGS.dailyCallBudget).toBeLessThan(54);
    expect(DEFAULT_OPERATIONS_SETTINGS.dailyCallBudget).toBeGreaterThan(0);
  });
});

describe("budget windows", () => {
  const now = new Date("2026-09-06T12:00:00.000Z");

  it("rolls the daily window back exactly 24 hours", () => {
    expect(dailyWindowStart(now).toISOString()).toBe("2026-09-05T12:00:00.000Z");
  });

  it("rolls the monthly window back 30 days", () => {
    expect(monthlyWindowStart(now).toISOString()).toBe("2026-08-07T12:00:00.000Z");
  });

  it("does not mutate the instant it is given", () => {
    const before = now.getTime();
    dailyWindowStart(now);
    monthlyWindowStart(now);
    expect(now.getTime()).toBe(before);
  });
});
