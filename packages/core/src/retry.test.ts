import { describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS,
  REQUESTED_CALLBACK_HORIZON_DAYS,
  resolveRequestedCallback,
  scheduleRetry,
} from "./retry";
import { localToInstant } from "./window";

const SP = "America/Sao_Paulo";
// 2026-09-07 is a Monday.
const at = (day: number, hour: number, minute = 0) =>
  localToInstant({ year: 2026, month: 9, day, hour, minute }, SP);

describe("scheduleRetry", () => {
  it("schedules the first retry 15 minutes after the actual end", () => {
    expect(scheduleRetry({ attemptNumber: 1, endedAt: at(7, 10), tz: SP })).toEqual(at(7, 10, 15));
  });

  it("measures from the actual end, not the planned start", () => {
    expect(scheduleRetry({ attemptNumber: 1, endedAt: at(7, 10, 20), tz: SP })).toEqual(at(7, 10, 35));
  });

  it("pushes a first retry that lands after 22:00 to the next morning", () => {
    expect(scheduleRetry({ attemptNumber: 1, endedAt: at(7, 21, 50), tz: SP })).toEqual(at(8, 8));
  });

  it("schedules the second retry 2 days later, pushed into the window", () => {
    // Monday 21:50 -> Wednesday 21:50 is inside the window.
    expect(scheduleRetry({ attemptNumber: 2, endedAt: at(7, 21, 50), tz: SP })).toEqual(at(9, 21, 50));
    // Monday 22:30 -> Wednesday 22:30 is outside -> Thursday 08:00.
    expect(scheduleRetry({ attemptNumber: 2, endedAt: at(7, 22, 30), tz: SP })).toEqual(at(10, 8));
  });

  it("returns null after the last attempt", () => {
    expect(MAX_ATTEMPTS).toBe(3);
    expect(scheduleRetry({ attemptNumber: 3, endedAt: at(7, 10), tz: SP })).toBeNull();
  });

  it("honours a requested callback time inside the window", () => {
    expect(scheduleRetry({ attemptNumber: 1, endedAt: at(7, 16), tz: SP, requestedAt: at(7, 19) })).toEqual(at(7, 19));
  });

  it("pushes a requested callback time outside the window to the next opening", () => {
    expect(scheduleRetry({ attemptNumber: 1, endedAt: at(7, 16), tz: SP, requestedAt: at(7, 23) })).toEqual(at(8, 8));
  });

  it("rejects a zero attempt number", () => {
    expect(() => scheduleRetry({ attemptNumber: 0, endedAt: at(7, 10), tz: SP })).toThrow(RangeError);
  });
});

describe("resolveRequestedCallback", () => {
  const endedAt = new Date("2026-09-06T13:00:00Z");

  it("uses a time inside the horizon", () => {
    const at = new Date("2026-09-06T22:00:00Z");
    expect(resolveRequestedCallback({ requestedAt: at, endedAt })).toEqual({ use: true, at });
  });

  it("rejects an absent or unparseable time", () => {
    expect(resolveRequestedCallback({ requestedAt: null, endedAt })).toEqual({ use: false, reason: "none" });
    expect(resolveRequestedCallback({ requestedAt: undefined, endedAt })).toEqual({ use: false, reason: "none" });
    expect(resolveRequestedCallback({ requestedAt: new Date("nonsense"), endedAt })).toEqual({
      use: false,
      reason: "none",
    });
  });

  it("rejects a time at or before the end of the attempt", () => {
    // Measured from the END of the call, not from now: the lead said
    // "tomorrow" during the call and scoring may run minutes later.
    expect(resolveRequestedCallback({ requestedAt: endedAt, endedAt })).toEqual({ use: false, reason: "in_past" });
    expect(resolveRequestedCallback({ requestedAt: new Date("2026-09-06T12:59:59Z"), endedAt })).toEqual({
      use: false,
      reason: "in_past",
    });
  });

  it("rejects a time beyond the horizon", () => {
    const justInside = new Date(endedAt.getTime() + REQUESTED_CALLBACK_HORIZON_DAYS * 86_400_000);
    const justOutside = new Date(justInside.getTime() + 1);
    expect(resolveRequestedCallback({ requestedAt: justInside, endedAt }).use).toBe(true);
    expect(resolveRequestedCallback({ requestedAt: justOutside, endedAt })).toEqual({
      use: false,
      reason: "beyond_horizon",
    });
  });

  it("takes an explicit horizon", () => {
    const inSixDays = new Date(endedAt.getTime() + 6 * 86_400_000);
    expect(resolveRequestedCallback({ requestedAt: inSixDays, endedAt, horizonDays: 7 }).use).toBe(true);
    expect(resolveRequestedCallback({ requestedAt: inSixDays, endedAt, horizonDays: 5 })).toEqual({
      use: false,
      reason: "beyond_horizon",
    });
  });

  it("leaves the interval policy untouched when it refuses", () => {
    // The fallback is not "no retry": it is the ordinary 15-minute / 2-day
    // schedule, unchanged.
    const verdict = resolveRequestedCallback({ requestedAt: new Date("2027-01-01T10:00:00Z"), endedAt });
    expect(verdict.use).toBe(false);
    expect(scheduleRetry({ attemptNumber: 1, endedAt, tz: "America/Sao_Paulo" })).toEqual(
      new Date(endedAt.getTime() + 15 * 60 * 1000),
    );
  });

  it("hands an accepted time to scheduleRetry, which still clamps it to the window", () => {
    // 23:00 local in Sao Paulo is outside 08:00-22:00, so it moves to 08:00 the
    // next day like any other attempt. One window implementation, not two.
    const requested = new Date("2026-09-07T02:00:00Z"); // 23:00 local on the 6th
    const verdict = resolveRequestedCallback({ requestedAt: requested, endedAt });
    expect(verdict.use).toBe(true);
    if (!verdict.use) return;

    const scheduled = scheduleRetry({
      attemptNumber: 1,
      endedAt,
      tz: "America/Sao_Paulo",
      requestedAt: verdict.at,
    });
    const local = scheduled!.toLocaleString("en-US", { timeZone: "America/Sao_Paulo", hour12: false });
    expect(local).toContain("08:00:00");
    expect(local).toContain("9/7/2026");
  });
});
