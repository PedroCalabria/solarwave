import { callAttempts, leads, qualificationCriteria, type Db } from "@solarwave/db";
import { openTestDb } from "@solarwave/db/test";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mintCallToken } from "./callToken";
import type { VoiceConfig } from "./config";
import { resolveStreamStart } from "./mediaSession";

let db: Db;
let truncate: () => Promise<void>;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, truncate, close } = await openTestDb());
});
afterAll(async () => {
  await close();
});

const LEAD_ID = "11111111-1111-1111-1111-111111111111";
const SID = "CA_REAL";
const NOW = new Date("2026-09-06T15:00:00Z");

const CONFIG: VoiceConfig = {
  twilio: { accountSid: "AC1", apiKeySid: "SK1", apiKeySecret: "s", fromNumber: "+15005550006" },
  publicBaseUrl: "https://example.dev",
  streamTokenSecret: "secret",
  wrapUpSeconds: 90,
  maxCallSeconds: 180,
  trialAccount: true,
};

const token = () => mintCallToken(SID, CONFIG.streamTokenSecret);

beforeEach(async () => {
  await truncate();
  await db.insert(qualificationCriteria).values({
    key: "homeowner",
    label: "Homeowner",
    questionPt: "O imóvel é seu?",
    questionEn: "Do you own the property?",
    type: "boolean",
    expectedValue: "true",
    weight: 30,
    blocking: true,
  });
  await db.insert(leads).values({
    id: LEAD_ID,
    name: "Ana",
    email: "ana@example.com",
    phone: "+5511999990000",
    ddd: "11",
    timezone: "America/Sao_Paulo",
    status: "calling",
  });
  await db.insert(callAttempts).values({
    leadId: LEAD_ID,
    attemptNumber: 1,
    scheduledAt: NOW,
    startedAt: NOW,
    twilioCallSid: SID,
  });
});

const start = (over: Partial<Parameters<typeof resolveStreamStart>[0]> = {}) =>
  resolveStreamStart({ db, config: CONFIG, callSid: SID, token: token(), ...over });

describe("resolveStreamStart", () => {
  it("admits a stream whose token matches its call", async () => {
    const result = await start();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attempt.twilioCallSid).toBe(SID);
    expect(result.lead.name).toBe("Ana");
    expect(result.criteria.map((c) => c.key)).toEqual(["homeowner"]);
  });

  it("refuses a missing token before it reads anything", async () => {
    expect(await start({ token: null })).toEqual({ ok: false, reason: "bad_token" });
  });

  it("refuses a token minted for another call", async () => {
    // Otherwise a valid stream could be opened on someone else's call and its
    // transcript written into the wrong lead.
    const other = mintCallToken("CA_SOMEONE_ELSE", CONFIG.streamTokenSecret);
    expect(await start({ token: other })).toEqual({ ok: false, reason: "bad_token" });
  });

  it("refuses a token signed with another secret", async () => {
    expect(await start({ token: mintCallToken(SID, "not-our-secret") })).toEqual({
      ok: false,
      reason: "bad_token",
    });
  });

  it("refuses an expired token", async () => {
    const stale = mintCallToken(SID, CONFIG.streamTokenSecret, 1000, 0);
    expect(await start({ token: stale })).toEqual({ ok: false, reason: "bad_token" });
  });

  it("refuses a call it has never heard of", async () => {
    const unknown = "CA_NOT_OURS";
    expect(await start({ callSid: unknown, token: mintCallToken(unknown, CONFIG.streamTokenSecret) })).toEqual({
      ok: false,
      reason: "unknown_call",
    });
  });

  it("refuses a stream on an attempt that already ended", async () => {
    // The token outlives the call by design, so a replay has to be refused
    // explicitly rather than by the clock.
    await db.update(callAttempts).set({ endedAt: NOW, outcome: "no_answer" }).where(eq(callAttempts.leadId, LEAD_ID));
    expect(await start()).toEqual({ ok: false, reason: "attempt_already_ended" });
  });

  it("refuses when the lead is gone", async () => {
    await db.delete(callAttempts).where(eq(callAttempts.leadId, LEAD_ID));
    await db.delete(leads).where(eq(leads.id, LEAD_ID));
    await db.insert(leads).values({
      id: "22222222-2222-2222-2222-222222222222",
      name: "Outro",
      email: "o@example.com",
      phone: "+5511900000000",
      ddd: "11",
      timezone: "America/Sao_Paulo",
    });
    await db.insert(callAttempts).values({
      leadId: "22222222-2222-2222-2222-222222222222",
      attemptNumber: 1,
      scheduledAt: NOW,
      startedAt: NOW,
      twilioCallSid: SID,
    });
    await db.delete(leads).where(eq(leads.id, "22222222-2222-2222-2222-222222222222"));
    expect(await start()).toMatchObject({ ok: false });
  });

  it("refuses when no criterion is active, rather than calling with nothing to ask", async () => {
    await db.update(qualificationCriteria).set({ active: false });
    expect(await start()).toEqual({ ok: false, reason: "no_active_criteria" });
  });
});
