import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client";
import { callAttempts, guardrailViolations, leads } from "../schema";
import { openTestDb } from "../test/harness";
import {
  attachCallSid,
  createDispatchedAttempt,
  findAttemptByCallSid,
  finishAttempt,
  persistLiveTranscript,
  reconcileStaleAttempts,
} from "./realAttempts";

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
const NOW = new Date("2026-09-05T14:00:00Z");

async function seedLead(status: "new" | "calling" | "waiting_retry" | "opt_out" = "new", attemptCount = 0) {
  await db.insert(leads).values({
    id: LEAD_ID,
    name: "Ana Souza",
    email: "ana@example.com",
    phone: "+5511999990000",
    ddd: "11",
    timezone: "America/Sao_Paulo",
    preferredCallLanguage: "pt",
    status,
    attemptCount,
  });
}

const leadRow = async () => (await db.select().from(leads).where(eq(leads.id, LEAD_ID)))[0]!;

describe("createDispatchedAttempt", () => {
  it("reserves the attempt and moves the lead to calling", async () => {
    await seedLead();
    const result = await createDispatchedAttempt(db, { leadId: LEAD_ID, now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attemptNumber).toBe(1);
    expect(result.attempt.startedAt).toEqual(NOW);
    expect(result.attempt.endedAt).toBeNull();
    expect(result.attempt.outcome).toBeNull();
    expect(result.attempt.twilioCallSid).toBeNull();
    expect(result.lead.status).toBe("calling");
    expect(result.lead.nextCallAt).toBeNull();
  });

  it("numbers attempts from the highest already stored", async () => {
    await seedLead("waiting_retry", 1);
    await db.insert(callAttempts).values({
      leadId: LEAD_ID,
      attemptNumber: 1,
      scheduledAt: NOW,
      startedAt: NOW,
      endedAt: NOW,
      outcome: "no_answer",
    });
    const result = await createDispatchedAttempt(db, { leadId: LEAD_ID, now: NOW });
    expect(result.ok && result.attemptNumber).toBe(2);
  });

  it("refuses a lead that opted out", async () => {
    await seedLead("opt_out");
    const result = await createDispatchedAttempt(db, { leadId: LEAD_ID, now: NOW });
    expect(result).toEqual({ ok: false, reason: "opted_out" });
  });

  it("refuses a missing lead", async () => {
    const result = await createDispatchedAttempt(db, { leadId: LEAD_ID, now: NOW });
    expect(result).toEqual({ ok: false, reason: "lead_not_found" });
  });

  it("refuses while an attempt is in flight", async () => {
    await seedLead();
    const first = await createDispatchedAttempt(db, { leadId: LEAD_ID, now: NOW });
    expect(first.ok).toBe(true);
    const second = await createDispatchedAttempt(db, { leadId: LEAD_ID, now: NOW });
    expect(second).toEqual({ ok: false, reason: "attempt_in_flight" });
  });

  it("refuses at the attempt cap", async () => {
    await seedLead("waiting_retry", 3);
    for (const n of [1, 2, 3]) {
      await db.insert(callAttempts).values({
        leadId: LEAD_ID,
        attemptNumber: n,
        scheduledAt: NOW,
        startedAt: NOW,
        endedAt: NOW,
        outcome: "no_answer",
      });
    }
    const result = await createDispatchedAttempt(db, { leadId: LEAD_ID, now: NOW });
    expect(result).toEqual({ ok: false, reason: "attempt_cap_reached" });
  });

  it("refuses while an unreviewed high-severity violation stands", async () => {
    await seedLead("waiting_retry", 1);
    const [past] = await db
      .insert(callAttempts)
      .values({
        leadId: LEAD_ID,
        attemptNumber: 1,
        scheduledAt: NOW,
        startedAt: NOW,
        endedAt: NOW,
        outcome: "answered_incomplete",
      })
      .returning();
    await db.insert(guardrailViolations).values({
      callAttemptId: past!.id,
      guardrail: "no_prices",
      severity: "high",
    });

    const result = await createDispatchedAttempt(db, { leadId: LEAD_ID, now: NOW });
    expect(result).toEqual({ ok: false, reason: "blocked_by_violation" });
  });

  it("allows dispatch once the violation is reviewed", async () => {
    await seedLead("waiting_retry", 1);
    const [past] = await db
      .insert(callAttempts)
      .values({
        leadId: LEAD_ID,
        attemptNumber: 1,
        scheduledAt: NOW,
        startedAt: NOW,
        endedAt: NOW,
        outcome: "answered_incomplete",
      })
      .returning();
    await db.insert(guardrailViolations).values({
      callAttemptId: past!.id,
      guardrail: "no_prices",
      severity: "high",
      reviewedAt: NOW,
    });

    const result = await createDispatchedAttempt(db, { leadId: LEAD_ID, now: NOW });
    expect(result.ok).toBe(true);
  });

  it("lets exactly one of two concurrent dispatches through", async () => {
    // The check has to be inside the transaction that inserts, because losing
    // this race places a telephone call that cannot be recalled.
    await seedLead();
    const [a, b] = await Promise.all([
      createDispatchedAttempt(db, { leadId: LEAD_ID, now: NOW }),
      createDispatchedAttempt(db, { leadId: LEAD_ID, now: NOW }),
    ]);

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const rows = await db.select().from(callAttempts).where(eq(callAttempts.leadId, LEAD_ID));
    expect(rows).toHaveLength(1);
  });
});

describe("the call SID", () => {
  it("is attached after the provider answers, and finds the attempt again", async () => {
    await seedLead();
    const created = await createDispatchedAttempt(db, { leadId: LEAD_ID, now: NOW });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await attachCallSid(db, created.attempt.id, "CA123");
    const found = await findAttemptByCallSid(db, "CA123");
    expect(found?.id).toBe(created.attempt.id);
  });

  it("returns null for an unknown SID", async () => {
    expect(await findAttemptByCallSid(db, "CAnope")).toBeNull();
  });
});

describe("persistLiveTranscript", () => {
  it("keeps what the bridge heard before it died", async () => {
    await seedLead();
    const created = await createDispatchedAttempt(db, { leadId: LEAD_ID, now: NOW });
    if (!created.ok) throw new Error("dispatch failed");

    await persistLiveTranscript(db, created.attempt.id, [{ who: "ai", text: "Olá" }]);
    await persistLiveTranscript(db, created.attempt.id, [
      { who: "ai", text: "Olá" },
      { who: "lead", text: "Oi" },
    ]);

    const [row] = await db.select().from(callAttempts).where(eq(callAttempts.id, created.attempt.id));
    expect(row!.transcript).toHaveLength(2);
    expect(row!.endedAt).toBeNull();
  });
});

describe("finishAttempt", () => {
  async function dispatched() {
    await seedLead();
    const created = await createDispatchedAttempt(db, { leadId: LEAD_ID, now: NOW });
    if (!created.ok) throw new Error("dispatch failed");
    return created.attempt;
  }

  it("closes the attempt and retries a no-answer", async () => {
    const attempt = await dispatched();
    const retryAt = new Date(NOW.getTime() + 15 * 60 * 1000);
    const result = await finishAttempt(db, {
      attemptId: attempt.id,
      outcome: "no_answer",
      nextCallAt: retryAt,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attempt.endedAt).not.toBeNull();
    expect(result.lead.status).toBe("waiting_retry");
    expect(result.lead.nextCallAt).toEqual(retryAt);
    expect(result.lead.attemptCount).toBe(1);
  });

  it("sets the twelve-month transcript expiry when it stores one", async () => {
    const attempt = await dispatched();
    const endedAt = new Date("2026-09-05T14:02:00Z");
    const result = await finishAttempt(db, {
      attemptId: attempt.id,
      outcome: "answered_incomplete",
      transcript: [{ who: "ai", text: "Olá" }],
      endedAt,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attempt.transcriptExpiresAt?.getUTCFullYear()).toBe(2027);
  });

  it("leaves answered_complete for the scoring worker to decide", async () => {
    const attempt = await dispatched();
    const result = await finishAttempt(db, { attemptId: attempt.id, outcome: "answered_complete" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Closed, but not qualified: only a real score may say that.
    expect(result.attempt.endedAt).not.toBeNull();
    expect((await leadRow()).status).toBe("calling");
  });

  it("applies a decision when scoring supplies one", async () => {
    const attempt = await dispatched();
    const result = await finishAttempt(db, {
      attemptId: attempt.id,
      outcome: "answered_complete",
      decision: "qualified",
    });
    expect(result.ok && result.lead.status).toBe("qualified");
  });

  it("makes opt-out terminal and clears the next call", async () => {
    const attempt = await dispatched();
    const result = await finishAttempt(db, {
      attemptId: attempt.id,
      outcome: "opt_out",
      nextCallAt: new Date("2026-09-07T14:00:00Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lead.status).toBe("opt_out");
    expect(result.lead.optOutAt).not.toBeNull();
    // A retry time offered alongside a terminal outcome is ignored, not stored.
    expect(result.lead.nextCallAt).toBeNull();
  });

  it("disqualifies an abusive call without a retry", async () => {
    const attempt = await dispatched();
    const result = await finishAttempt(db, { attemptId: attempt.id, outcome: "abusive" });
    expect(result.ok && result.lead.status).toBe("disqualified");
    expect((await leadRow()).nextCallAt).toBeNull();
  });

  it("closes exactly once when the provider retries the callback", async () => {
    const attempt = await dispatched();
    const first = await finishAttempt(db, { attemptId: attempt.id, outcome: "no_answer" });
    const second = await finishAttempt(db, { attemptId: attempt.id, outcome: "failed" });

    expect(first.ok && first.alreadyClosed).toBe(false);
    expect(second.ok && second.alreadyClosed).toBe(true);

    const [row] = await db.select().from(callAttempts).where(eq(callAttempts.id, attempt.id));
    // The second outcome did not overwrite the first.
    expect(row!.outcome).toBe("no_answer");
    expect((await leadRow()).attemptCount).toBe(1);
  });

  it("reports a missing attempt rather than throwing", async () => {
    const result = await finishAttempt(db, {
      attemptId: "99999999-9999-9999-9999-999999999999",
      outcome: "failed",
    });
    expect(result).toEqual({ ok: false, reason: "attempt_not_found" });
  });
});

describe("reconcileStaleAttempts", () => {
  it("recovers a lead whose callback never arrived", async () => {
    await seedLead();
    const created = await createDispatchedAttempt(db, { leadId: LEAD_ID, now: NOW });
    if (!created.ok) throw new Error("dispatch failed");

    const later = new Date(NOW.getTime() + 20 * 60 * 1000);
    const { closed } = await reconcileStaleAttempts(db, { maxCallSeconds: 180, now: later });

    expect(closed).toEqual([created.attempt.id]);
    const lead = await leadRow();
    // Retryable, so the lead is dispatchable again rather than stuck.
    expect(lead.status).toBe("waiting_retry");
  });

  it("leaves a call that is still inside its budget alone", async () => {
    await seedLead();
    await createDispatchedAttempt(db, { leadId: LEAD_ID, now: NOW });

    const soon = new Date(NOW.getTime() + 60 * 1000);
    const { closed } = await reconcileStaleAttempts(db, { maxCallSeconds: 180, now: soon });

    expect(closed).toEqual([]);
    expect((await leadRow()).status).toBe("calling");
  });

  it("leaves a call inside the margin alone", async () => {
    await seedLead();
    await createDispatchedAttempt(db, { leadId: LEAD_ID, now: NOW });

    // Past the hard stop but inside the grace period: a late callback is not a
    // lost one, and closing a live call would be the worse bug.
    const justPast = new Date(NOW.getTime() + 200 * 1000);
    const { closed } = await reconcileStaleAttempts(db, { maxCallSeconds: 180, now: justPast });
    expect(closed).toEqual([]);
  });

  it("ignores attempts that already ended", async () => {
    await seedLead();
    const created = await createDispatchedAttempt(db, { leadId: LEAD_ID, now: NOW });
    if (!created.ok) throw new Error("dispatch failed");
    await finishAttempt(db, { attemptId: created.attempt.id, outcome: "no_answer" });

    const later = new Date(NOW.getTime() + 20 * 60 * 1000);
    expect((await reconcileStaleAttempts(db, { maxCallSeconds: 180, now: later })).closed).toEqual([]);
  });
});
