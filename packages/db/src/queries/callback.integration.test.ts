import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client";
import { callAttempts, leads } from "../schema";
import { openTestDb } from "../test/harness";
import { saveScoringResult } from "./attempts";

/**
 * The guards on a lead-requested callback (lifecycle-and-operations D6).
 *
 * These live at the persistence layer because that is where the guarantee is:
 * `saveScoringResult` holds the lead row lock while it computes the transition
 * and writes `next_call_at`, so the rule "opt-out outranks a callback asked for
 * in the same call" is enforced against a concurrent writer, not merely in the
 * order the worker happens to call things.
 */

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
const ATTEMPT_ID = "22222222-2222-2222-2222-222222222222";
const ENDED_AT = new Date("2026-09-06T17:00:00Z");
const CALLBACK_AT = new Date("2026-09-07T12:00:00Z");

async function seed(status: "calling" | "opt_out" | "qualified" = "calling") {
  await db.insert(leads).values({
    id: LEAD_ID,
    name: "Ana Souza",
    email: "ana@example.com",
    phone: "+5511999990000",
    ddd: "11",
    timezone: "America/Sao_Paulo",
    status,
    nextCallAt: new Date("2026-09-06T17:15:00Z"),
  });
  await db.insert(callAttempts).values({
    id: ATTEMPT_ID,
    leadId: LEAD_ID,
    attemptNumber: 1,
    scheduledAt: ENDED_AT,
    startedAt: ENDED_AT,
    endedAt: ENDED_AT,
    outcome: "answered_incomplete",
  });
}

const leadRow = async () => (await db.select().from(leads).where(eq(leads.id, LEAD_ID)))[0]!;
const attemptRow = async () => (await db.select().from(callAttempts).where(eq(callAttempts.id, ATTEMPT_ID)))[0]!;

const save = (extra: Parameters<typeof saveScoringResult>[1]) => saveScoringResult(db, extra);

const BASE = {
  attemptId: ATTEMPT_ID,
  leadId: LEAD_ID,
  answers: [],
  score: 40,
  reason: "Not enough information yet.",
  icebreaker: null,
};

describe("a requested callback", () => {
  it("moves the next call to the requested time", async () => {
    await seed("calling");

    const result = await save({
      ...BASE,
      requestedCallback: { said: "me liga amanhã de manhã", at: CALLBACK_AT },
      callbackNextCallAt: CALLBACK_AT,
      event: { type: "attempt_ended", outcome: "answered_incomplete", attemptCount: 1 },
    });

    expect(result.ok).toBe(true);
    expect((await leadRow()).nextCallAt).toEqual(CALLBACK_AT);
  });

  it("stores the verbatim phrase even when nothing usable resolved", async () => {
    await seed("calling");

    await save({
      ...BASE,
      requestedCallback: { said: "me liga qualquer hora dessas", at: null },
      event: { type: "attempt_ended", outcome: "answered_incomplete", attemptCount: 1 },
    });

    const attempt = await attemptRow();
    expect(attempt.requestedCallbackRaw).toBe("me liga qualquer hora dessas");
    expect(attempt.requestedCallbackAt).toBeNull();
    // The interval policy stood: whatever the callback path did, it did not
    // clear the retry the status callback had already scheduled.
    expect((await leadRow()).nextCallAt).toEqual(new Date("2026-09-06T17:15:00Z"));
  });

  it("NEVER reschedules a lead that opted out in the same call", async () => {
    // Spec section 6. The lead asked to be called back and then asked never to
    // be contacted again; the second instruction outranks the first.
    await seed("calling");

    const result = await save({
      ...BASE,
      requestedCallback: { said: "me liga amanhã", at: CALLBACK_AT },
      callbackNextCallAt: CALLBACK_AT,
      event: { type: "attempt_ended", outcome: "opt_out", attemptCount: 1 },
    });

    expect(result.ok).toBe(true);
    const lead = await leadRow();
    expect(lead.status).toBe("opt_out");
    expect(lead.nextCallAt).toBeNull();
    expect(lead.optOutAt).not.toBeNull();
  });

  it("never reschedules a lead that reached a terminal status", async () => {
    await seed("calling");

    await save({
      ...BASE,
      score: 88,
      requestedCallback: { said: "me liga amanhã", at: CALLBACK_AT },
      callbackNextCallAt: CALLBACK_AT,
      event: { type: "attempt_ended", outcome: "answered_complete", attemptCount: 1, decision: "qualified" },
    });

    const lead = await leadRow();
    expect(lead.status).toBe("qualified");
    expect(lead.nextCallAt).toBeNull();
  });

  it("cannot resurrect a lead that had already opted out", async () => {
    await seed("opt_out");

    const result = await save({
      ...BASE,
      requestedCallback: { said: "me liga amanhã", at: CALLBACK_AT },
      callbackNextCallAt: CALLBACK_AT,
      event: { type: "attempt_ended", outcome: "answered_incomplete", attemptCount: 1 },
    });

    // The transition table refuses to move a terminal lead at all.
    expect(result.ok).toBe(false);
    const lead = await leadRow();
    expect(lead.status).toBe("opt_out");
  });

  it("is idempotent: re-running produces the same next call time", async () => {
    await seed("calling");

    const args = {
      ...BASE,
      requestedCallback: { said: "me liga amanhã de manhã", at: CALLBACK_AT },
      callbackNextCallAt: CALLBACK_AT,
    };
    await save({ ...args, event: { type: "attempt_ended", outcome: "answered_incomplete", attemptCount: 1 } });
    const first = (await leadRow()).nextCallAt;

    // A re-drive omits the event, because the lead has already moved.
    await save(args);
    expect((await leadRow()).nextCallAt).toEqual(first);
    expect((await attemptRow()).requestedCallbackAt).toEqual(CALLBACK_AT);
  });

  it("leaves the attempt untouched when no callback context was supplied", async () => {
    await seed("calling");

    await save({ ...BASE, event: { type: "attempt_ended", outcome: "answered_incomplete", attemptCount: 1 } });

    const attempt = await attemptRow();
    expect(attempt.requestedCallbackRaw).toBeNull();
    expect(attempt.requestedCallbackAt).toBeNull();
  });
});
