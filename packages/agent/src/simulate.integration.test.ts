import { fakeToolCallingModel, type FakeTurn } from "@solarwave/ai";
import { callAttempts, leads, qualificationCriteria, type Db } from "@solarwave/db";
import { openTestDb } from "@solarwave/db/test";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { simulateCall } from "./simulate";

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
  await seed();
});

const LEAD_ID = "11111111-1111-1111-1111-111111111111";

async function seed(status: "new" | "opt_out" = "new") {
  await db.insert(leads).values({
    id: LEAD_ID,
    name: "Beatriz Almeida",
    email: "beatriz@example.com",
    phone: "+5511988887777",
    ddd: "11",
    timezone: "America/Sao_Paulo",
    preferredCallLanguage: "pt",
    status,
  });
  await db.insert(qualificationCriteria).values([
    {
      key: "homeowner",
      label: "Homeowner verification",
      questionPt: "O imóvel é seu ou alugado?",
      questionEn: "Do you own the property?",
      type: "boolean",
      expectedValue: "true",
      weight: 30,
      blocking: true,
      sortOrder: 1,
    },
    {
      key: "monthly_bill",
      label: "Monthly bill",
      questionPt: "Qual o valor da conta?",
      questionEn: "What is your bill?",
      type: "numeric",
      expectedValue: ">= 300",
      weight: 25,
      sortOrder: 2,
    },
  ]);
}

const run = (turns: FakeTurn[], over = {}) =>
  simulateCall({
    db,
    leadId: LEAD_ID,
    model: fakeToolCallingModel(turns),
    respond: async () => "Sim.",
    now: new Date("2026-09-05T14:00:00Z"),
    ...over,
  });

const COMPLETE: FakeTurn[] = [
  {
    text: "Obrigado pelas respostas.",
    toolCalls: [
      { name: "record_answer", input: { criterion_key: "homeowner", value: "true" } },
      { name: "record_answer", input: { criterion_key: "monthly_bill", value: "480" } },
      { name: "end_call", input: { reason: "enough_information" } },
    ],
  },
];

const readLead = async () => (await db.select().from(leads).where(eq(leads.id, LEAD_ID)))[0]!;
const readAttempts = async () => db.select().from(callAttempts).where(eq(callAttempts.leadId, LEAD_ID));

describe("simulateCall", () => {
  it("persists the conversation as a real, marked attempt", async () => {
    const result = await run(COMPLETE);

    expect(result.status).toBe("done");
    if (result.status !== "done") return;

    const [attempt] = await readAttempts();
    expect(attempt!.id).toBe(result.attemptId);
    expect(attempt!.endedReason).toBe("simulated");
    expect(attempt!.twilioCallSid).toBeNull();
    expect(attempt!.transcript).toEqual(result.transcript);
    expect(attempt!.scoringStatus).toBe("pending");
  });

  it("moves the lead through dispatch before the call", async () => {
    await run(COMPLETE);

    // `dispatch` happened, so the lead left `new`. It stays `calling` because
    // only scoring can supply the decision an answered_complete needs.
    expect((await readLead()).status).toBe("calling");
  });

  it("asks in the lead's call language", async () => {
    await db.update(leads).set({ preferredCallLanguage: "en" }).where(eq(leads.id, LEAD_ID));
    const result = await run(COMPLETE);

    expect(result.status).toBe("done");
  });

  describe("outcomes and transitions", () => {
    it("leaves a complete call in calling, for the scoring worker to decide", async () => {
      const result = await run(COMPLETE);

      expect(result.status === "done" && result.outcome).toBe("answered_complete");
      // Design D3 of scoring-worker: never invent a decision. The lead waits
      // for a real score rather than getting a fabricated qualification.
      expect((await readLead()).status).toBe("calling");
      expect((await readLead()).score).toBeNull();
    });

    it("moves an incomplete call to waiting_retry with a next call inside the window", async () => {
      const result = await run([{ text: "Alô?" }, { toolCalls: [{ name: "end_call", input: { reason: "incomplete" } }] }]);

      expect(result.status === "done" && result.outcome).toBe("answered_incomplete");
      const lead = await readLead();
      expect(lead.status).toBe("waiting_retry");
      expect(lead.nextCallAt).not.toBeNull();

      // 08:00-22:00 in America/Sao_Paulo.
      const local = new Date(lead.nextCallAt!).toLocaleString("en-US", {
        timeZone: "America/Sao_Paulo",
        hour: "numeric",
        hour12: false,
      });
      expect(Number(local)).toBeGreaterThanOrEqual(8);
      expect(Number(local)).toBeLessThan(22);
    });

    it("disqualifies a hostile lead without scheduling a retry", async () => {
      const result = await run([{ toolCalls: [{ name: "end_call", input: { reason: "hostile" } }] }]);

      expect(result.status === "done" && result.outcome).toBe("abusive");
      const lead = await readLead();
      expect(lead.status).toBe("disqualified");
      expect(lead.nextCallAt).toBeNull();
    });

    it("retries when a minor answered", async () => {
      const result = await run([{ toolCalls: [{ name: "flag_minor", input: {} }] }]);

      expect(result.status === "done" && result.outcome).toBe("minor_answered");
      const lead = await readLead();
      expect(lead.status).toBe("waiting_retry");
      expect(lead.nextCallAt).not.toBeNull();
    });

    it("makes an opt-out terminal and clears the next call", async () => {
      const result = await run([{ toolCalls: [{ name: "mark_opt_out", input: {} }] }]);

      expect(result.status === "done" && result.outcome).toBe("opt_out");
      const lead = await readLead();
      expect(lead.status).toBe("opt_out");
      expect(lead.nextCallAt).toBeNull();
      expect(lead.optOutAt).not.toBeNull();
    });
  });

  describe("refusals", () => {
    it("refuses an unknown lead and writes nothing", async () => {
      const result = await run(COMPLETE, { leadId: "44444444-4444-4444-4444-444444444444" });

      expect(result).toEqual({ status: "refused", reason: "lead_not_found" });
      expect(await readAttempts()).toHaveLength(0);
    });

    it("refuses to simulate contact with an opted-out lead", async () => {
      await truncate();
      await seed("opt_out");

      const result = await run(COMPLETE);

      expect(result).toEqual({ status: "refused", reason: "opted_out" });
      expect(await readAttempts()).toHaveLength(0);
      expect((await readLead()).status).toBe("opt_out");
    });

    it("refuses a second call while one is in flight", async () => {
      // The first simulation left the lead `calling`; `dispatch` is illegal
      // from there, which is what makes the refusal safe rather than advisory.
      await run(COMPLETE);
      const second = await run(COMPLETE);

      expect(second).toEqual({ status: "refused", reason: "attempt_in_flight" });
      expect(await readAttempts()).toHaveLength(1);
    });

    it("refuses when no criterion is active", async () => {
      await db.update(qualificationCriteria).set({ active: false });

      const result = await run(COMPLETE);

      expect(result).toEqual({ status: "refused", reason: "no_active_criteria" });
      expect(await readAttempts()).toHaveLength(0);
      expect((await readLead()).status).toBe("new");
    });
  });

  it("numbers a retry attempt after the first", async () => {
    await run([{ toolCalls: [{ name: "end_call", input: { reason: "incomplete" } }] }]);
    const second = await run([{ toolCalls: [{ name: "end_call", input: { reason: "incomplete" } }] }]);

    expect(second.status === "done" && second.attemptNumber).toBe(2);
    expect(await readAttempts()).toHaveLength(2);
  });
});
