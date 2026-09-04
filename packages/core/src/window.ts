/**
 * Call-window arithmetic on IANA zones through Intl, so a future change to
 * Brazilian daylight saving needs no code change (design D6).
 */

export const CALL_WINDOW_START_HOUR = 8;
export const CALL_WINDOW_END_HOUR = 22;

export type LocalParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Wall-clock parts of an instant in the given zone. */
export function toLocalParts(instant: Date, tz: string): LocalParts {
  const parts = formatterFor(tz).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of `tz` from UTC at `instant`, in milliseconds. */
function offsetAt(instant: Date, tz: string): number {
  const p = toLocalParts(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant at which the given wall-clock time occurs in `tz`. */
export function localToInstant(parts: Omit<LocalParts, "second"> & { second?: number }, tz: string): Date {
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second ?? 0);
  // First guess assumes the offset at the wall time read as UTC; refine once
  // with the offset at the resulting instant to survive DST transitions.
  const guess = new Date(wall - offsetAt(new Date(wall), tz));
  return new Date(wall - offsetAt(guess, tz));
}

export function isWithinCallWindow(instant: Date, tz: string): boolean {
  const { hour } = toLocalParts(instant, tz);
  return hour >= CALL_WINDOW_START_HOUR && hour < CALL_WINDOW_END_HOUR;
}

/**
 * `instant` if it is inside 08:00-22:00 local time; otherwise the next 08:00
 * local (same day when before the window, next day when at or after 22:00).
 */
export function nextAllowedTime(instant: Date, tz: string): Date {
  if (isWithinCallWindow(instant, tz)) return instant;
  const p = toLocalParts(instant, tz);
  const opening = localToInstant(
    { year: p.year, month: p.month, day: p.day, hour: CALL_WINDOW_START_HOUR, minute: 0 },
    tz,
  );
  if (p.hour < CALL_WINDOW_START_HOUR) return opening;
  return addDaysLocal(opening, 1, tz);
}

/** Adds calendar days in `tz` keeping the same wall-clock time. */
export function addDaysLocal(instant: Date, days: number, tz: string): Date {
  const p = toLocalParts(instant, tz);
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + days, p.hour, p.minute, p.second));
  return localToInstant(
    {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: p.hour,
      minute: p.minute,
      second: p.second,
    },
    tz,
  );
}
