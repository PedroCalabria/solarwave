import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, scheduleRetry } from "./retry";
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
