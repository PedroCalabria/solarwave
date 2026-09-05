import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client";
import { callAttempts, leads } from "../schema";
import { openTestDb } from "../test/harness";
import { SIMULATED_REASON, createSimulatedAttempt, isSimulated } from "./attempts";

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

const LEAD_ID = "11111111-1111-1111-1111-111111111111";
const MISSING = "44444444-4444-4444-4444-444444444444";

const STARTED = new Date("2026-09-05T14:00:00Z");
const ENDED = new Date("2026-09-05T14:02:00Z");

async function seedLead(status: "new" | "calling" | "opt_out" = "new") {
  await db.insert(leads).values({
    id: LEAD_ID,
    name: "Beatriz",
    email: "beatriz@example.com",
    phone: "+5511988887777",
    ddd: "11",
    timezone: "America/Sao_Paulo",
    status,
  });
}

const input = {
  leadId: LEAD_ID,
  transcript: [
    { who: "ai" as const, text: "Olá, sou o assistente virtual da Soltera." },
    { who: "lead" as const, text: "Pode falar." },
  ],
  startedAt: STARTED,
  endedAt: ENDED,
  outcome: "answered_complete" as const,
};

describe("createSimulatedAttempt", () => {
  it("writes an attempt carrying the transcript", async () => {
    await seedLead();
    const result = await createSimulatedAttempt(db, input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attemptNumber).toBe(1);
    expect(result.attempt.transcript).toEqual(input.transcript);
    expect(result.attempt.outcome).toBe("answered_complete");
  });

  it("marks it without a schema change: ended_reason and a null sid", async () => {
    await seedLead();
    const result = await createSimulatedAttempt(db, input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attempt.endedReason).toBe(SIMULATED_REASON);
    expect(result.attempt.twilioCallSid).toBeNull();
    expect(isSimulated(result.attempt)).toBe(true);
  });

  it("leaves the attempt pending so the scoring worker picks it up", async () => {
    await seedLead();
    const result = await createSimulatedAttempt(db, input);

    expect(result.ok && result.attempt.scoringStatus).toBe("pending");
  });

  it("sets the twelve-month retention date from the call (spec section 10)", async () => {
    await seedLead();
    const result = await createSimulatedAttempt(db, input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expires = result.attempt.transcriptExpiresAt!;
    expect(expires.getTime()).toBeGreaterThan(ENDED.getTime());
    expect(expires.getFullYear()).toBe(2027);
  });

  it("numbers a second attempt after the first", async () => {
    await seedLead();
    const first = await createSimulatedAttempt(db, input);
    expect(first.ok).toBe(true);

    const second = await createSimulatedAttempt(db, input);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.attemptNumber).toBe(2);
  });

  it("admits many simulated attempts despite the unique sid index", async () => {
    // Postgres allows repeated NULLs in a unique index; this is what makes the
    // `ended_reason` marker work without a migration.
    await seedLead();
    await createSimulatedAttempt(db, input);
    await createSimulatedAttempt(db, input);

    const rows = await db.select().from(callAttempts).where(eq(callAttempts.leadId, LEAD_ID));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.twilioCallSid === null)).toBe(true);
  });

  describe("refusals", () => {
    it("refuses for an unknown lead", async () => {
      const result = await createSimulatedAttempt(db, { ...input, leadId: MISSING });

      expect(result).toEqual({ ok: false, reason: "lead_not_found" });
    });

    it("refuses to simulate contact with an opted-out lead", async () => {
      // Spec section 6: opt-out is terminal and outranks everything. Simulating
      // a call to someone who asked not to be contacted contradicts it even in
      // a demo.
      await seedLead("opt_out");
      const result = await createSimulatedAttempt(db, input);

      expect(result).toEqual({ ok: false, reason: "opted_out" });
    });

    it("writes nothing when it refuses", async () => {
      await seedLead("opt_out");
      await createSimulatedAttempt(db, input);

      const rows = await db.select().from(callAttempts).where(eq(callAttempts.leadId, LEAD_ID));
      expect(rows).toHaveLength(0);
    });

    it("refuses while an attempt is still in flight", async () => {
      await seedLead("calling");
      await db.insert(callAttempts).values({
        leadId: LEAD_ID,
        attemptNumber: 1,
        scheduledAt: STARTED,
        startedAt: STARTED,
        endedAt: null,
      });

      const result = await createSimulatedAttempt(db, input);

      expect(result).toEqual({ ok: false, reason: "attempt_in_flight" });
    });

    it("allows a new attempt once the previous one has ended", async () => {
      await seedLead("waiting_retry" as "new");
      await db.insert(callAttempts).values({
        leadId: LEAD_ID,
        attemptNumber: 1,
        scheduledAt: STARTED,
        startedAt: STARTED,
        endedAt: ENDED,
        outcome: "no_answer",
      });

      const result = await createSimulatedAttempt(db, input);

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.attemptNumber).toBe(2);
    });
  });
});

describe("isSimulated", () => {
  it("is false for a real call", () => {
    expect(isSimulated({ endedReason: "completed" })).toBe(false);
    expect(isSimulated({ endedReason: null })).toBe(false);
  });
});
