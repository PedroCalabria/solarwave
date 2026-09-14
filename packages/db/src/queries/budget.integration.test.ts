import { DEFAULT_OPERATIONS_SETTINGS } from "@solarwave/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client";
import { callAttempts, leads, SETTING_KEYS, settings } from "../schema";
import { openTestDb } from "../test/harness";
import { getBudgetConsumption } from "./budget";
import { createDispatchedAttempt, finishAttempt, recordSessionResult } from "./realAttempts";
import { getOperationsSettings } from "./settings";

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

const NOW = new Date("2026-09-06T14:00:00Z");
const SIMULATED_REASON = "simulated";

function leadId(n: number): string {
  return `11111111-1111-1111-1111-${String(n).padStart(12, "0")}`;
}

async function seedLead(n: number) {
  await db.insert(leads).values({
    id: leadId(n),
    name: `Lead ${n}`,
    email: `lead${n}@example.com`,
    phone: `+55119999${String(n).padStart(5, "0")}`,
    ddd: "11",
    timezone: "America/Sao_Paulo",
    preferredCallLanguage: "pt",
    status: "new",
  });
}

async function setOperations(values: { enabled?: boolean; daily?: number; monthly?: number }) {
  const rows = [
    values.enabled !== undefined ? { key: SETTING_KEYS.autoDispatchEnabled, value: values.enabled } : null,
    values.daily !== undefined ? { key: SETTING_KEYS.dailyCallBudget, value: values.daily } : null,
    values.monthly !== undefined ? { key: SETTING_KEYS.monthlyVoiceSecondsBudget, value: values.monthly } : null,
  ].filter((r) => r !== null);

  for (const row of rows) {
    await db
      .insert(settings)
      .values({ key: row.key, value: row.value })
      .onConflictDoUpdate({ target: settings.key, set: { value: row.value } });
  }
}

/** A closed attempt that consumed telephony, written directly. */
async function pastCall(n: number, opts: { startedAt: Date; telephonySeconds?: number; simulated?: boolean }) {
  await seedLead(n);
  await db.insert(callAttempts).values({
    leadId: leadId(n),
    attemptNumber: 1,
    scheduledAt: opts.startedAt,
    startedAt: opts.startedAt,
    endedAt: opts.startedAt,
    outcome: "answered_complete",
    endedReason: opts.simulated ? SIMULATED_REASON : "completed",
    ...(opts.telephonySeconds !== undefined ? { telephonySeconds: opts.telephonySeconds } : {}),
  });
}

describe("getBudgetConsumption", () => {
  it("counts nothing when nothing has happened", async () => {
    expect(await getBudgetConsumption(db, NOW)).toEqual({ callsToday: 0, voiceSecondsThisMonth: 0 });
  });

  it("counts real calls inside the daily window and sums their seconds", async () => {
    await pastCall(1, { startedAt: new Date("2026-09-06T10:00:00Z"), telephonySeconds: 120 });
    await pastCall(2, { startedAt: new Date("2026-09-06T11:00:00Z"), telephonySeconds: 90 });

    expect(await getBudgetConsumption(db, NOW)).toEqual({ callsToday: 2, voiceSecondsThisMonth: 210 });
  });

  it("drops a call out of the daily window but keeps its seconds in the monthly one", async () => {
    // Two days ago: outside 24 hours, inside 30 days.
    await pastCall(1, { startedAt: new Date("2026-09-04T14:00:00Z"), telephonySeconds: 300 });

    expect(await getBudgetConsumption(db, NOW)).toEqual({ callsToday: 0, voiceSecondsThisMonth: 300 });
  });

  it("EXCLUDES simulated attempts from both figures", async () => {
    // The demo's free end-to-end path must not be able to exhaust the budget
    // that protects the metered one.
    await pastCall(1, { startedAt: new Date("2026-09-06T10:00:00Z"), telephonySeconds: 0, simulated: true });
    await pastCall(2, { startedAt: new Date("2026-09-06T11:00:00Z"), telephonySeconds: 120 });

    expect(await getBudgetConsumption(db, NOW)).toEqual({ callsToday: 1, voiceSecondsThisMonth: 120 });
  });

  it("counts a dispatched attempt that recorded no seconds", async () => {
    // A dispatch the provider rejected spends no minutes but consumes an
    // attempt, and a loop failing that way is what the daily budget stops.
    await pastCall(1, { startedAt: new Date("2026-09-06T10:00:00Z") });

    expect(await getBudgetConsumption(db, NOW)).toEqual({ callsToday: 1, voiceSecondsThisMonth: 0 });
  });
});

describe("getOperationsSettings", () => {
  it("returns the shipped defaults when nothing is stored", async () => {
    expect(await getOperationsSettings(db)).toEqual(DEFAULT_OPERATIONS_SETTINGS);
  });

  it("reads stored values, including a false switch", async () => {
    await setOperations({ enabled: true, daily: 2, monthly: 60 });
    expect(await getOperationsSettings(db)).toEqual({
      autoDispatchEnabled: true,
      dailyCallBudget: 2,
      monthlyVoiceSecondsBudget: 60,
    });

    await setOperations({ enabled: false });
    expect((await getOperationsSettings(db)).autoDispatchEnabled).toBe(false);
  });

  it("falls back to the default rather than trusting a malformed row", async () => {
    // A wrong-typed row silently disabling the brake is the one failure this
    // setting exists to prevent.
    await db
      .insert(settings)
      .values({ key: SETTING_KEYS.autoDispatchEnabled, value: "yes" as unknown as boolean })
      .onConflictDoUpdate({ target: settings.key, set: { value: "yes" as unknown as boolean } });
    await db
      .insert(settings)
      .values({ key: SETTING_KEYS.dailyCallBudget, value: -5 })
      .onConflictDoUpdate({ target: settings.key, set: { value: -5 } });

    const read = await getOperationsSettings(db);
    expect(read.autoDispatchEnabled).toBe(false);
    expect(read.dailyCallBudget).toBe(DEFAULT_OPERATIONS_SETTINGS.dailyCallBudget);
  });
});

describe("the brake, inside the reserving transaction", () => {
  it("refuses the run while automatic dispatch is off and lets a human through", async () => {
    await setOperations({ enabled: false, daily: 10, monthly: 4500 });
    await seedLead(1);

    const asRun = await createDispatchedAttempt(db, { leadId: leadId(1), now: NOW, origin: "run" });
    expect(asRun).toMatchObject({ ok: false, reason: "auto_dispatch_disabled" });

    const asHuman = await createDispatchedAttempt(db, { leadId: leadId(1), now: NOW, origin: "human" });
    expect(asHuman.ok).toBe(true);
  });

  it("defaults an undeclared caller to human", async () => {
    // Every caller written before this change omits the origin, and none of
    // them is the scheduler. Defaulting the other way would silently stop the
    // portal's call button the moment the flag shipped off.
    await setOperations({ enabled: false });
    await seedLead(1);

    expect((await createDispatchedAttempt(db, { leadId: leadId(1), now: NOW })).ok).toBe(true);
  });

  it("refuses BOTH origins when a budget is spent, and names which", async () => {
    await setOperations({ enabled: true, daily: 1, monthly: 4500 });
    await pastCall(9, { startedAt: new Date("2026-09-06T10:00:00Z"), telephonySeconds: 60 });
    await seedLead(1);

    const asRun = await createDispatchedAttempt(db, { leadId: leadId(1), now: NOW, origin: "run" });
    expect(asRun).toMatchObject({ ok: false, reason: "budget_exhausted" });
    if (!asRun.ok) expect(asRun.detail).toContain("daily_calls");

    const asHuman = await createDispatchedAttempt(db, { leadId: leadId(1), now: NOW, origin: "human" });
    expect(asHuman).toMatchObject({ ok: false, reason: "budget_exhausted" });
  });

  it("names the voice budget when that is the exhausted one", async () => {
    await setOperations({ enabled: true, daily: 99, monthly: 100 });
    await pastCall(9, { startedAt: new Date("2026-09-06T10:00:00Z"), telephonySeconds: 100 });
    await seedLead(1);

    const result = await createDispatchedAttempt(db, { leadId: leadId(1), now: NOW, origin: "human" });
    expect(result).toMatchObject({ ok: false, reason: "budget_exhausted" });
    if (!result.ok) expect(result.detail).toContain("monthly_voice_seconds");
  });

  it("keeps opt-out ahead of every budget", async () => {
    // Spec section 6. Whichever reason is reported, no attempt may exist.
    await setOperations({ enabled: true, daily: 0, monthly: 0 });
    await seedLead(1);
    await db.update(leads).set({ status: "opt_out" }).where(eq(leads.id, leadId(1)));

    const result = await createDispatchedAttempt(db, { leadId: leadId(1), now: NOW, origin: "human" });
    expect(result).toMatchObject({ ok: false, reason: "opted_out" });
    expect(await db.select().from(callAttempts)).toHaveLength(0);
  });

  it("lets exactly ONE of two simultaneous dispatches through the last unit of budget", async () => {
    // The test that matters: a telephone call cannot be recalled, so losing
    // this race has to be impossible rather than unlikely.
    await setOperations({ enabled: true, daily: 1, monthly: 4500 });
    await seedLead(1);
    await seedLead(2);

    const [a, b] = await Promise.all([
      createDispatchedAttempt(db, { leadId: leadId(1), now: NOW, origin: "run" }),
      createDispatchedAttempt(db, { leadId: leadId(2), now: NOW, origin: "run" }),
    ]);

    const allowed = [a, b].filter((r) => r.ok);
    const refused = [a, b].filter((r) => !r.ok);
    expect(allowed).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ reason: "budget_exhausted" });
    expect(await db.select().from(callAttempts)).toHaveLength(1);
  });
});

describe("recording what a call consumed", () => {
  it("stores the provider duration and the observed session duration", async () => {
    await seedLead(1);
    const created = await createDispatchedAttempt(db, { leadId: leadId(1), now: NOW, origin: "human" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await recordSessionResult(db, created.attempt.id, {
      outcome: "answered_complete",
      endedReason: "end_call",
      realtimeSeconds: 97,
    });
    const closed = await finishAttempt(db, {
      attemptId: created.attempt.id,
      outcome: "answered_complete",
      decision: "qualified",
      telephonySeconds: 112,
      endedAt: NOW,
    });

    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.attempt.telephonySeconds).toBe(112);
    expect(closed.attempt.realtimeSeconds).toBe(97);
  });

  it("records nothing rather than a zero when a call never connected", async () => {
    // A zero presented as a measurement is worse than an absence: it says the
    // call happened and cost nothing.
    await seedLead(1);
    const created = await createDispatchedAttempt(db, { leadId: leadId(1), now: NOW, origin: "human" });
    if (!created.ok) return;

    const closed = await finishAttempt(db, { attemptId: created.attempt.id, outcome: "no_answer", endedAt: NOW });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.attempt.telephonySeconds).toBeNull();
    expect(closed.attempt.realtimeSeconds).toBeNull();
  });

  it("does not let a later close erase what the bridge already reported", async () => {
    // The status callback usually knows nothing about the realtime session, and
    // reconciliation knows nothing at all. Neither may overwrite with silence.
    await seedLead(1);
    const created = await createDispatchedAttempt(db, { leadId: leadId(1), now: NOW, origin: "human" });
    if (!created.ok) return;

    await recordSessionResult(db, created.attempt.id, {
      outcome: "answered_incomplete",
      endedReason: "hard_stop",
      realtimeSeconds: 180,
    });
    const closed = await finishAttempt(db, {
      attemptId: created.attempt.id,
      outcome: "answered_incomplete",
      endedAt: NOW,
    });

    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.attempt.realtimeSeconds).toBe(180);
  });

  it("feeds the recorded seconds straight into the budget", async () => {
    await seedLead(1);
    const created = await createDispatchedAttempt(db, { leadId: leadId(1), now: NOW, origin: "human" });
    if (!created.ok) return;
    await finishAttempt(db, {
      attemptId: created.attempt.id,
      outcome: "answered_complete",
      decision: "qualified",
      telephonySeconds: 150,
      endedAt: NOW,
    });

    expect(await getBudgetConsumption(db, NOW)).toEqual({ callsToday: 1, voiceSecondsThisMonth: 150 });
  });
});
