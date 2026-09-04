import { describe, expect, it } from "vitest";
import { addDaysLocal, isWithinCallWindow, localToInstant, nextAllowedTime, toLocalParts } from "./window";

const SP = "America/Sao_Paulo";
const MANAUS = "America/Manaus";

const at = (tz: string, day: number, hour: number, minute = 0) =>
  localToInstant({ year: 2026, month: 9, day, hour, minute }, tz);

describe("localToInstant / toLocalParts", () => {
  it("round-trips a wall-clock time", () => {
    const d = at(SP, 3, 14, 30);
    expect(toLocalParts(d, SP)).toMatchObject({ year: 2026, month: 9, day: 3, hour: 14, minute: 30 });
  });

  it("uses the zone offset (São Paulo is UTC-3)", () => {
    expect(at(SP, 3, 12).toISOString()).toBe("2026-09-03T15:00:00.000Z");
    expect(at(MANAUS, 3, 12).toISOString()).toBe("2026-09-03T16:00:00.000Z");
  });
});

describe("isWithinCallWindow", () => {
  it("is true inside the window", () => {
    expect(isWithinCallWindow(at(SP, 3, 9), SP)).toBe(true);
    expect(isWithinCallWindow(at(SP, 3, 21, 59), SP)).toBe(true);
  });

  it("is false before 08:00 and at/after 22:00", () => {
    expect(isWithinCallWindow(at(SP, 3, 7, 59), SP)).toBe(false);
    expect(isWithinCallWindow(at(SP, 3, 22), SP)).toBe(false);
    expect(isWithinCallWindow(at(SP, 3, 23, 10), SP)).toBe(false);
  });

  it("depends on the zone for the same instant", () => {
    const instant = at(SP, 3, 21, 30); // 20:30 in Manaus
    expect(isWithinCallWindow(instant, SP)).toBe(true);
    expect(isWithinCallWindow(instant, MANAUS)).toBe(true);

    const later = new Date(instant.getTime() + 30 * 60 * 1000); // 22:00 SP, 21:00 Manaus
    expect(isWithinCallWindow(later, SP)).toBe(false);
    expect(isWithinCallWindow(later, MANAUS)).toBe(true);
  });
});

describe("nextAllowedTime", () => {
  it("returns the candidate when inside the window", () => {
    const c = at(SP, 3, 9);
    expect(nextAllowedTime(c, SP)).toEqual(c);
  });

  it("pushes an early candidate to 08:00 the same day", () => {
    expect(nextAllowedTime(at(SP, 3, 6, 45), SP)).toEqual(at(SP, 3, 8));
  });

  it("pushes exactly 22:00 to 08:00 the next day", () => {
    expect(nextAllowedTime(at(SP, 3, 22), SP)).toEqual(at(SP, 4, 8));
  });

  it("pushes a late-night candidate to 08:00 the next day in the lead's zone", () => {
    expect(nextAllowedTime(at(MANAUS, 3, 23, 10), MANAUS)).toEqual(at(MANAUS, 4, 8));
  });
});

describe("addDaysLocal", () => {
  it("keeps the wall-clock time across a month boundary", () => {
    const d = localToInstant({ year: 2026, month: 8, day: 31, hour: 21, minute: 50 }, SP);
    expect(toLocalParts(addDaysLocal(d, 2, SP), SP)).toMatchObject({ month: 9, day: 2, hour: 21, minute: 50 });
  });
});
