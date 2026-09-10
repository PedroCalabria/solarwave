import {
  SETTING_KEYS,
  applyLeadTransition,
  callAttempts,
  closeDb,
  employees,
  getLeadById,
  leads,
  updateSetting,
  type Db,
} from "@solarwave/db";
import { openTestDb } from "@solarwave/db/test";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dispatchForRun, readLead, retryAfter, settleScoring } from "./steps";

/**
 * The steps, as ordinary functions (lifecycle-and-operations D2).
 *
 * They are the only part of the run that touches Postgres, so this is where the
 * behaviour that matters can be asserted without a workflow runtime at all.
 * `getDb()` and `openTestDb()` resolve to the same server when DATABASE_URL is
 * set, which is why `truncate()` clears what the steps see.
 */

const hasDb = Boolean(process.env.DATABASE_URL ?? process.env.POSTGRES_URL);

describe.skipIf(!hasDb)("leadWorkflow steps", () => {
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
  });

  const LEAD_ID = "11111111-1111-1111-1111-111111111111";
  const NEXT_CALL = new Date("2026-09-06T15:00:00Z");

  async function seedLead(status: "new" | "calling" | "waiting_retry" | "opt_out" | "qualified" = "new") {
    await db.insert(leads).values({
      id: LEAD_ID,
      name: "Ana Souza",
      email: "ana@example.com",
      phone: "+5511999990000",
      ddd: "11",
      timezone: "America/Sao_Paulo",
      preferredCallLanguage: "pt",
      status,
      nextCallAt: NEXT_CALL,
    });
  }

  const ADMIN_ID = "55555555-5555-5555-5555-555555555555";

  // Goes through `updateSetting` rather than a raw upsert, so the switch is
  // flipped the way an administrator flips it — audit row included.
  async function setAutoDispatch(enabled: boolean) {
    await db
      .insert(employees)
      .values({ id: ADMIN_ID, name: "Lucas", email: "lucas@example.com", role: "admin" })
      .onConflictDoNothing();
    await updateSetting(db, SETTING_KEYS.autoDispatchEnabled, enabled, ADMIN_ID);
  }

  describe("readLead", () => {
    it("reports a lead the run can act on", async () => {
      await seedLead("waiting_retry");
      const snapshot = await readLead(LEAD_ID);

      expect(snapshot).toMatchObject({ found: true, status: "waiting_retry", terminal: false });
      expect(snapshot.nextCallAt).toEqual(NEXT_CALL);
      expect(snapshot.timezone).toBe("America/Sao_Paulo");
    });

    it("reports a terminal lead as terminal, so the run ends", async () => {
      await seedLead("qualified");
      expect(await readLead(LEAD_ID)).toMatchObject({ found: true, terminal: true });
    });

    it("reports an opted-out lead as terminal", async () => {
      // Spec section 6, seen from the scheduler's side: the run must never wake
      // up and dial a lead that asked not to be contacted.
      await seedLead("opt_out");
      expect(await readLead(LEAD_ID)).toMatchObject({ found: true, status: "opt_out", terminal: true });
    });

    it("treats a missing lead as terminal rather than throwing", async () => {
      expect(await readLead(LEAD_ID)).toMatchObject({ found: false, terminal: true });
    });

    it("returns a serializable snapshot", async () => {
      // Everything crossing a step boundary has to survive serialization; a
      // database row would not.
      await seedLead("new");
      const snapshot = await readLead(LEAD_ID);
      expect(() => structuredClone(snapshot)).not.toThrow();
    });
  });

  describe("dispatchForRun", () => {
    it("is refused while automatic dispatch is off, and writes nothing", async () => {
      await setAutoDispatch(false);
      await seedLead("new");

      const result = await dispatchForRun(LEAD_ID);

      expect(result).toMatchObject({ status: "refused", reason: "auto_dispatch_disabled", attemptId: null });
      expect(await db.select().from(callAttempts)).toHaveLength(0);
      // D3's reversibility claim, asserted rather than described: the run left
      // the lead exactly as the other paths had it.
      expect(await getLeadById(db, LEAD_ID)).toMatchObject({ status: "new", nextCallAt: NEXT_CALL });
    });

    it("refuses an opted-out lead even with dispatch enabled", async () => {
      await setAutoDispatch(true);
      await seedLead("opt_out");

      const result = await dispatchForRun(LEAD_ID);

      expect(result).toMatchObject({ status: "refused", reason: "opted_out" });
      expect(await db.select().from(callAttempts)).toHaveLength(0);
    });

    it("reports a refusal reason as a plain string the workflow can classify", async () => {
      await setAutoDispatch(true);
      await seedLead("new");
      await applyLeadTransition(db, LEAD_ID, { type: "opt_out" });

      const result = await dispatchForRun(LEAD_ID);
      expect(typeof result.reason).toBe("string");
      expect(() => structuredClone(result)).not.toThrow();
    });
  });

  describe("settleScoring", () => {
    const ATTEMPT_ID = "22222222-2222-2222-2222-222222222222";

    async function seedAttempt(patch: Partial<typeof callAttempts.$inferInsert> = {}) {
      await db.insert(callAttempts).values({
        id: ATTEMPT_ID,
        leadId: LEAD_ID,
        attemptNumber: 1,
        scheduledAt: NEXT_CALL,
        startedAt: NEXT_CALL,
        ...patch,
      });
    }

    it("treats a missing attempt as settled", async () => {
      expect(await settleScoring(ATTEMPT_ID)).toEqual({ settled: true });
    });

    it("reports an attempt still in flight as unsettled", async () => {
      await seedLead("calling");
      await seedAttempt();
      expect(await settleScoring(ATTEMPT_ID)).toEqual({ settled: false });
    });

    it("treats a closed attempt with no transcript as settled", async () => {
      // No answer, busy, voicemail: nothing to extract from, nothing to wait for.
      await seedLead("calling");
      await seedAttempt({ endedAt: NEXT_CALL, outcome: "no_answer" });
      expect(await settleScoring(ATTEMPT_ID)).toEqual({ settled: true });
    });

    it("treats an already-scored attempt as settled without re-scoring", async () => {
      await seedLead("calling");
      await seedAttempt({
        endedAt: NEXT_CALL,
        outcome: "answered_complete",
        transcript: [{ who: "lead", text: "É meu, moro aqui há nove anos." }],
        scoringStatus: "done",
        scoredAt: NEXT_CALL,
      });
      expect(await settleScoring(ATTEMPT_ID)).toEqual({ settled: true });
    });
  });

  describe("retryAfter", () => {
    it("pushes a backoff into the lead's call window", async () => {
      await seedLead("waiting_retry");
      const at = await retryAfter(LEAD_ID, 60 * 60);

      const hour = Number(
        at.toLocaleString("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }),
      );
      expect(hour).toBeGreaterThanOrEqual(8);
      expect(hour).toBeLessThan(22);
    });

    it("still returns a time for a lead that vanished", async () => {
      // The workflow sleeps on this value; returning nothing would be a crash
      // in the one place a crash is least useful.
      const at = await retryAfter(LEAD_ID, 60);
      expect(at.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe("the run writes no lifecycle state (D3)", () => {
    it("leaves leads and attempts as the callback and scoring paths left them", async () => {
      await setAutoDispatch(false);
      await seedLead("waiting_retry");
      await applyLeadTransition(db, LEAD_ID, { type: "dispatch" });
      const before = await getLeadById(db, LEAD_ID);

      await readLead(LEAD_ID);
      await dispatchForRun(LEAD_ID);
      await settleScoring("22222222-2222-2222-2222-222222222222");

      const after = await getLeadById(db, LEAD_ID);
      expect(after?.status).toBe(before?.status);
      expect(after?.score).toBe(before?.score);
      expect(after?.attemptCount).toBe(before?.attemptCount);
    });
  });
});
