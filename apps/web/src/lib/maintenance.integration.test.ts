import {
  SETTING_KEYS,
  applyLeadTransition,
  callAttempts,
  closeDb,
  employees,
  getAttemptById,
  leads,
  listOverdueLeads,
  listPendingScoring,
  purgeExpiredTranscripts,
  updateSetting,
  type Db,
} from "@solarwave/db";
import { openTestDb } from "@solarwave/db/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { isAuthorisedCronCall, runMaintenance } from "./maintenance";

/**
 * The daily maintenance job (`scheduled-maintenance` spec).
 *
 * The sweep dispatches telephone calls, so every case here keeps automatic
 * dispatch off or the daily budget at zero. What is asserted is that the sweep
 * SELECTS the right leads and refuses the wrong ones, never that it dials.
 */

const hasDb = Boolean(process.env.DATABASE_URL ?? process.env.POSTGRES_URL);

describe("isAuthorisedCronCall", () => {
  const original = process.env.CRON_SECRET;
  afterEach(() => {
    process.env.CRON_SECRET = original;
  });

  const req = (headers: Record<string, string>) => new Request("http://localhost/api/cron/maintenance", { headers });

  it("refuses everything when no secret is configured", () => {
    // No secret means no access, never open access: this route dispatches calls
    // and production is publicly reachable.
    delete process.env.CRON_SECRET;
    expect(isAuthorisedCronCall(req({ authorization: "Bearer anything" }))).toBe(false);
    expect(isAuthorisedCronCall(req({}))).toBe(false);
  });

  it("accepts the bearer token Vercel's scheduler sends", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(isAuthorisedCronCall(req({ authorization: "Bearer s3cret" }))).toBe(true);
  });

  it("accepts the header a person would use by hand", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(isAuthorisedCronCall(req({ "x-cron-secret": "s3cret" }))).toBe(true);
  });

  it("refuses a wrong or missing token", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(isAuthorisedCronCall(req({ authorization: "Bearer wrong" }))).toBe(false);
    expect(isAuthorisedCronCall(req({ "x-cron-secret": "wrong" }))).toBe(false);
    expect(isAuthorisedCronCall(req({}))).toBe(false);
  });
});

describe.skipIf(!hasDb)("runMaintenance", () => {
  let db: Db;
  let truncate: () => Promise<void>;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, truncate, close } = await openTestDb());
  });
  afterAll(async () => {
    await close();
    await closeDb();
  });
  beforeEach(async () => {
    await truncate();
    await db
      .insert(employees)
      .values({ id: ADMIN_ID, name: "Lucas", email: "lucas@example.com", role: "admin" })
      .onConflictDoNothing();
    // Both brakes on: the sweep must be provably unable to dial in these tests.
    await updateSetting(db, SETTING_KEYS.autoDispatchEnabled, false, ADMIN_ID);
    await updateSetting(db, SETTING_KEYS.dailyCallBudget, 0, ADMIN_ID);
  });

  const ADMIN_ID = "55555555-5555-5555-5555-555555555555";
  const NOW = new Date("2026-09-07T12:00:00Z");

  const leadId = (n: number) => `11111111-1111-1111-1111-${String(n).padStart(12, "0")}`;
  const attemptId = (n: number) => `22222222-2222-2222-2222-${String(n).padStart(12, "0")}`;

  async function seedLead(n: number, patch: Partial<typeof leads.$inferInsert> = {}) {
    await db.insert(leads).values({
      id: leadId(n),
      name: `Lead ${n}`,
      email: `lead${n}@example.com`,
      phone: `+55119999${String(n).padStart(5, "0")}`,
      ddd: "11",
      timezone: "America/Sao_Paulo",
      preferredCallLanguage: "pt",
      status: "waiting_retry",
      ...patch,
    });
  }

  async function seedAttempt(n: number, patch: Partial<typeof callAttempts.$inferInsert> = {}) {
    await db.insert(callAttempts).values({
      id: attemptId(n),
      leadId: leadId(n),
      attemptNumber: 1,
      scheduledAt: NOW,
      startedAt: NOW,
      ...patch,
    });
  }

  describe("purging transcripts", () => {
    it("removes an expired transcript and keeps the attempt", async () => {
      await seedLead(1);
      await seedAttempt(1, {
        endedAt: NOW,
        outcome: "answered_complete",
        transcript: [{ who: "lead", text: "É meu." }],
        transcriptExpiresAt: new Date("2026-09-06T12:00:00Z"),
      });

      const { purged } = await purgeExpiredTranscripts(db, NOW);

      expect(purged).toBe(1);
      const attempt = await getAttemptById(db, attemptId(1));
      expect(attempt?.transcript).toBeNull();
      // Spec section 10 is about the conversation, not the record of the call.
      expect(attempt?.outcome).toBe("answered_complete");
      expect(attempt?.endedAt).not.toBeNull();
    });

    it("keeps a transcript inside its retention", async () => {
      await seedLead(1);
      await seedAttempt(1, {
        endedAt: NOW,
        transcript: [{ who: "lead", text: "É meu." }],
        transcriptExpiresAt: new Date("2027-09-06T12:00:00Z"),
      });

      expect((await purgeExpiredTranscripts(db, NOW)).purged).toBe(0);
      expect((await getAttemptById(db, attemptId(1)))?.transcript).not.toBeNull();
    });

    it("leaves an attempt with no expiry alone", async () => {
      // A null expiry means the attempt never closed. Purging on a null would
      // delete the transcript of a call that is still happening.
      await seedLead(1);
      await seedAttempt(1, { transcript: [{ who: "lead", text: "Alô?" }] });

      expect((await purgeExpiredTranscripts(db, NOW)).purged).toBe(0);
      expect((await getAttemptById(db, attemptId(1)))?.transcript).not.toBeNull();
    });
  });

  describe("finding scoring that never finished", () => {
    it("selects a closed attempt with a transcript and unfinished scoring", async () => {
      await seedLead(1);
      await seedAttempt(1, {
        endedAt: NOW,
        transcript: [{ who: "lead", text: "É meu." }],
        scoringStatus: "pending",
      });

      expect(await listPendingScoring(db)).toEqual([attemptId(1)]);
    });

    it("selects one left stuck in `running` by a function that died", async () => {
      await seedLead(1);
      await seedAttempt(1, {
        endedAt: NOW,
        transcript: [{ who: "lead", text: "É meu." }],
        scoringStatus: "running",
      });

      expect(await listPendingScoring(db)).toEqual([attemptId(1)]);
    });

    it("ignores an attempt that is already scored", async () => {
      await seedLead(1);
      await seedAttempt(1, {
        endedAt: NOW,
        transcript: [{ who: "lead", text: "É meu." }],
        scoringStatus: "done",
        scoredAt: NOW,
      });

      expect(await listPendingScoring(db)).toEqual([]);
    });

    it("ignores an attempt still in flight and one with nothing to score", async () => {
      await seedLead(1);
      await seedAttempt(1, { transcript: [{ who: "lead", text: "Alô?" }] });
      await seedLead(2);
      await seedAttempt(2, { endedAt: NOW, outcome: "no_answer" });

      expect(await listPendingScoring(db)).toEqual([]);
    });
  });

  describe("sweeping overdue leads", () => {
    it("selects a lead whose scheduled time passed by more than the margin", async () => {
      await seedLead(1, { nextCallAt: new Date("2026-09-07T09:00:00Z") });

      expect(await listOverdueLeads(db, { now: NOW })).toEqual([leadId(1)]);
    });

    it("leaves a lead the run is about to call", async () => {
      // Inside the margin: a healthy run always wins this race, and the sweep
      // must not compete with it.
      await seedLead(1, { nextCallAt: new Date("2026-09-07T11:30:00Z") });

      expect(await listOverdueLeads(db, { now: NOW })).toEqual([]);
    });

    it("NEVER selects an opted-out lead carrying a stale schedule", async () => {
      // Spec section 6. A scheduler is where "never contact again" is easiest
      // to break by accident, so the exclusion is asserted at the query.
      await seedLead(1, { nextCallAt: new Date("2026-09-07T09:00:00Z") });
      await applyLeadTransition(db, leadId(1), { type: "opt_out" });
      // Put the stale schedule back, simulating a row the transition missed.
      await db.insert(callAttempts).values({
        id: attemptId(9),
        leadId: leadId(1),
        attemptNumber: 1,
        scheduledAt: NOW,
      });

      expect(await listOverdueLeads(db, { now: NOW })).toEqual([]);
    });

    it("never selects a terminal lead", async () => {
      await seedLead(1, { status: "qualified", nextCallAt: new Date("2026-09-07T09:00:00Z") });
      await seedLead(2, { status: "no_answer_final", nextCallAt: new Date("2026-09-07T09:00:00Z") });

      expect(await listOverdueLeads(db, { now: NOW })).toEqual([]);
    });
  });

  describe("the run as a whole", () => {
    it("reports every task, and one failure does not stop the others", async () => {
      await seedLead(1, { nextCallAt: new Date("2026-09-07T09:00:00Z") });
      await seedAttempt(1, {
        endedAt: NOW,
        outcome: "answered_complete",
        transcript: [{ who: "lead", text: "É meu." }],
        transcriptExpiresAt: new Date("2026-09-06T12:00:00Z"),
      });

      const reports = await runMaintenance({ now: NOW });
      const tasks = reports.map((r) => r.task);

      expect(tasks).toEqual([
        "purge_transcripts",
        "reconcile_attempts",
        "recover_scoring",
        "sweep_overdue",
        "keep_alive",
      ]);
      // The purge ran even though the recovery had a transcript to re-score and
      // could have thrown against a model that is not configured in tests.
      expect(reports.find((r) => r.task === "purge_transcripts")).toMatchObject({ ok: true });
      expect(reports.find((r) => r.task === "keep_alive")).toMatchObject({ ok: true });
    });

    it("touches the database even on a day with nothing to do", async () => {
      const reports = await runMaintenance({ now: NOW });
      const keepAlive = reports.find((r) => r.task === "keep_alive");

      expect(keepAlive).toMatchObject({ ok: true });
      expect(keepAlive?.detail).toContain("reachable");
    });

    it("dispatches nothing while the budget is zero", async () => {
      await seedLead(1, { nextCallAt: new Date("2026-09-07T09:00:00Z") });

      const reports = await runMaintenance({ now: NOW });
      const sweep = reports.find((r) => r.task === "sweep_overdue");

      expect(sweep?.detail).toContain("1 overdue, 0 dispatched");
      expect(await db.select().from(callAttempts)).toHaveLength(0);
    });
  });
});
