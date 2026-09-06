import { callAttempts, leads, qualificationCriteria, type Db } from "@solarwave/db";
import { openTestDb } from "@solarwave/db/test";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceConfig } from "./config";
import { dispatchCall, type PlaceCall } from "./dispatch";

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
});

const LEAD_ID = "11111111-1111-1111-1111-111111111111";

/** Inside the 08:00-22:00 window in America/Sao_Paulo (UTC-3). */
const MIDDAY = new Date("2026-09-08T15:00:00Z");
/** 03:00 local. */
const NIGHT = new Date("2026-09-08T06:00:00Z");

const CONFIG: VoiceConfig = {
  twilio: { accountSid: "AC1", apiKeySid: "SK1", apiKeySecret: "s", fromNumber: "+15005550006" },
  publicBaseUrl: "https://example.dev",
  streamTokenSecret: "secret",
  wrapUpSeconds: 90,
  maxCallSeconds: 180,
  machineDetection: false,
};

async function seedLead(status: "new" | "opt_out" = "new") {
  await db.insert(leads).values({
    id: LEAD_ID,
    name: "Ana",
    email: "ana@example.com",
    phone: "+5511999990000",
    ddd: "11",
    timezone: "America/Sao_Paulo",
    status,
  });
}

const placed: Parameters<PlaceCall>[0][] = [];
const placeCall: PlaceCall = async (input) => {
  placed.push(input);
  return "CA_TEST_SID";
};

beforeEach(() => {
  placed.length = 0;
});

describe("dispatchCall", () => {
  it("places the call and records the SID", async () => {
    await seedLead();
    const result = await dispatchCall({ db, leadId: LEAD_ID, config: CONFIG, placeCall, now: MIDDAY });

    expect(result.status).toBe("dispatched");
    if (result.status !== "dispatched") return;
    expect(result.callSid).toBe("CA_TEST_SID");
    expect(result.lead.status).toBe("calling");

    const [row] = await db.select().from(callAttempts).where(eq(callAttempts.leadId, LEAD_ID));
    expect(row!.twilioCallSid).toBe("CA_TEST_SID");
    expect(row!.endedAt).toBeNull();
  });

  it("gives Twilio both webhook URLs, each carrying a token, and a duration limit", async () => {
    await seedLead();
    await dispatchCall({ db, leadId: LEAD_ID, config: CONFIG, placeCall, now: MIDDAY });

    const call = placed[0]!;
    expect(call.instructionsUrl).toMatch(/^https:\/\/example\.dev\/api\/twilio\/voice\?t=.+\..+\..+$/);
    expect(call.statusCallbackUrl).toMatch(/^https:\/\/example\.dev\/api\/twilio\/status\?t=.+$/);
    // The provider hangs up even if the bridge stops enforcing the budget.
    expect(call.timeLimitSeconds).toBe(180);
    expect(call.to).toBe("+5511999990000");
  });

  it("leaves machine detection off unless the account can use it", async () => {
    // A trial account rejects the whole request when a premium parameter is
    // present, so this is opt-in rather than assumed.
    await seedLead();
    await dispatchCall({ db, leadId: LEAD_ID, config: CONFIG, placeCall, now: MIDDAY });
    expect(placed[0]!.machineDetection).toBe(false);

    await db.update(leads).set({ status: "new" }).where(eq(leads.id, LEAD_ID));
    await db.delete(callAttempts).where(eq(callAttempts.leadId, LEAD_ID));
    await dispatchCall({
      db,
      leadId: LEAD_ID,
      config: { ...CONFIG, machineDetection: true },
      placeCall,
      now: MIDDAY,
    });
    expect(placed[1]!.machineDetection).toBe(true);
  });

  it("refuses outside the call window without dialling", async () => {
    await seedLead();
    const result = await dispatchCall({ db, leadId: LEAD_ID, config: CONFIG, placeCall, now: NIGHT });
    expect(result).toMatchObject({ status: "refused", reason: "outside_call_window" });
    expect(placed).toHaveLength(0);
    // No attempt was reserved for a call that was never placed.
    expect(await db.select().from(callAttempts)).toHaveLength(0);
  });

  it("refuses an opted-out lead", async () => {
    await seedLead("opt_out");
    const result = await dispatchCall({ db, leadId: LEAD_ID, config: CONFIG, placeCall, now: MIDDAY });
    expect(result).toMatchObject({ status: "refused", reason: "opted_out" });
    expect(placed).toHaveLength(0);
  });

  it("refuses a missing lead", async () => {
    const result = await dispatchCall({ db, leadId: LEAD_ID, config: CONFIG, placeCall, now: MIDDAY });
    expect(result).toMatchObject({ status: "refused", reason: "lead_not_found" });
  });

  it("refuses when no criterion is active", async () => {
    await seedLead();
    await db.update(qualificationCriteria).set({ active: false });
    const result = await dispatchCall({ db, leadId: LEAD_ID, config: CONFIG, placeCall, now: MIDDAY });
    expect(result).toMatchObject({ status: "refused", reason: "no_active_criteria" });
    expect(placed).toHaveLength(0);
  });

  it("refuses a second call while one is in flight", async () => {
    await seedLead();
    await dispatchCall({ db, leadId: LEAD_ID, config: CONFIG, placeCall, now: MIDDAY });
    const second = await dispatchCall({ db, leadId: LEAD_ID, config: CONFIG, placeCall, now: MIDDAY });
    expect(second).toMatchObject({ status: "refused", reason: "attempt_in_flight" });
    expect(placed).toHaveLength(1);
  });

  it("refuses when telephony is not configured, and says what is missing", async () => {
    await seedLead();
    const result = await dispatchCall({ db, leadId: LEAD_ID, placeCall, now: MIDDAY, env: {} });
    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(result.reason).toBe("not_configured");
    expect(result.detail).toContain("TWILIO_ACCOUNT_SID");
    expect(placed).toHaveLength(0);
  });

  it("closes the attempt and schedules a retry when the provider throws", async () => {
    await seedLead();
    const failing: PlaceCall = async () => {
      throw new Error("Twilio is having a day");
    };

    const result = await dispatchCall({ db, leadId: LEAD_ID, config: CONFIG, placeCall: failing, now: MIDDAY });
    expect(result).toMatchObject({ status: "failed", retryScheduled: true });

    // The lead must not be left in flight because a provider had an outage.
    const [lead] = await db.select().from(leads).where(eq(leads.id, LEAD_ID));
    expect(lead!.status).toBe("waiting_retry");
    expect(lead!.nextCallAt).not.toBeNull();
    const [attempt] = await db.select().from(callAttempts).where(eq(callAttempts.leadId, LEAD_ID));
    expect(attempt!.outcome).toBe("failed");
    expect(attempt!.endedReason).toBe("dispatch_failed");
  });

  it("recovers a lead blocked by an attempt whose callback never arrived", async () => {
    await seedLead();
    // A call from long ago that was never closed. Without reconciliation this
    // lead is refused as `attempt_in_flight` forever.
    await db.insert(callAttempts).values({
      leadId: LEAD_ID,
      attemptNumber: 1,
      scheduledAt: new Date("2026-09-01T15:00:00Z"),
      startedAt: new Date("2026-09-01T15:00:00Z"),
    });
    await db.update(leads).set({ status: "calling" }).where(eq(leads.id, LEAD_ID));

    const result = await dispatchCall({ db, leadId: LEAD_ID, config: CONFIG, placeCall, now: MIDDAY });
    expect(result.status).toBe("dispatched");
    if (result.status !== "dispatched") return;
    expect(result.attemptNumber).toBe(2);
  });
});
