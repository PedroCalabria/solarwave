import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client";
import { openTestDb } from "../test/harness";
import { consumeIntakeRateLimit, hashIp } from "./rateLimit";

let db: Db;
let truncate: () => Promise<void>;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, truncate, close } = await openTestDb());
});
afterAll(async () => {
  await close();
});
beforeEach(async () => {
  await truncate();
});

describe("consumeIntakeRateLimit", () => {
  const ip = hashIp("203.0.113.7", "salt");

  it("allows five requests and blocks the sixth within a window", async () => {
    const now = new Date("2026-09-03T12:00:10Z");
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await consumeIntakeRateLimit(db, ip, now));
    expect(results.slice(0, 5).every((r) => r.allowed)).toBe(true);
    expect(results[5]).toMatchObject({ allowed: false, count: 6 });
    expect(results[5]!.resetAt.toISOString()).toBe("2026-09-03T12:01:00.000Z");
  });

  it("resets in the next window", async () => {
    const now = new Date("2026-09-03T12:00:10Z");
    for (let i = 0; i < 6; i++) await consumeIntakeRateLimit(db, ip, now);
    const later = await consumeIntakeRateLimit(db, ip, new Date("2026-09-03T12:01:01Z"));
    expect(later).toMatchObject({ allowed: true, count: 1 });
  });

  it("counts per client", async () => {
    const now = new Date("2026-09-03T12:00:10Z");
    for (let i = 0; i < 6; i++) await consumeIntakeRateLimit(db, ip, now);
    const other = await consumeIntakeRateLimit(db, hashIp("198.51.100.2", "salt"), now);
    expect(other.allowed).toBe(true);
  });

  it("hashIp is deterministic and salted", () => {
    expect(hashIp("1.2.3.4", "a")).toBe(hashIp("1.2.3.4", "a"));
    expect(hashIp("1.2.3.4", "a")).not.toBe(hashIp("1.2.3.4", "b"));
  });
});
