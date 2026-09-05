import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client";
import { callAttempts, employees, leads, qualificationAnswers, qualificationCriteria } from "../schema";
import { openTestDb } from "../test/harness";
import { loadAttemptForScoring, saveScoringResult, setScoringStatus, listScoringPendings } from "./attempts";

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
const C1 = "33333333-3333-3333-3333-333333333331";
const C2 = "33333333-3333-3333-3333-333333333332";
const MISSING = "44444444-4444-4444-4444-444444444444";

async function seed() {
  await db.insert(employees).values({
    id: "55555555-5555-5555-5555-555555555555",
    name: "Ana",
    email: "ana@example.com",
    role: "admin",
  });
  await db.insert(leads).values({
    id: LEAD_ID,
    name: "Maria",
    email: "maria@example.com",
    phone: "+5511999999999",
    ddd: "11",
    timezone: "America/Sao_Paulo",
    status: "calling",
    attemptCount: 1,
  });
  await db.insert(callAttempts).values({
    id: ATTEMPT_ID,
    leadId: LEAD_ID,
    attemptNumber: 1,
    scheduledAt: new Date("2026-09-01T12:00:00Z"),
    endedAt: new Date("2026-09-01T12:02:00Z"),
    outcome: "answered_complete",
    transcript: [{ who: "lead", text: "É meu." }],
  });
  await db.insert(qualificationCriteria).values([
    {
      id: C1,
      key: "homeowner",
      label: "Homeowner",
      questionPt: "?",
      questionEn: "?",
      type: "boolean",
      expectedValue: "true",
      weight: 30,
      blocking: true,
    },
    {
      id: C2,
      key: "roof_type",
      label: "Roof type",
      questionPt: "?",
      questionEn: "?",
      type: "enum",
      options: "ceramic|metal|slab",
      expectedValue: "ceramic|metal",
      weight: 20,
    },
  ]);
}

const answer = (criteriaId: string, value: unknown, passed: boolean | null, confidence = 0.9) => ({
  criteriaId,
  extractedValue: value === null ? null : String(value),
  normalizedValue: value,
  confidence,
  evidence: "É meu.",
  passed,
});

const answersFor = async (attemptId: string) =>
  db.select().from(qualificationAnswers).where(eq(qualificationAnswers.callAttemptId, attemptId));

const leadRow = async () => (await db.select().from(leads).where(eq(leads.id, LEAD_ID)))[0]!;
const attemptRow = async () => (await db.select().from(callAttempts).where(eq(callAttempts.id, ATTEMPT_ID)))[0]!;

describe("saveScoringResult", () => {
  beforeEach(seed);

  it("writes answers, score, narrative and scored_at in one transaction", async () => {
    const result = await saveScoringResult(db, {
      attemptId: ATTEMPT_ID,
      leadId: LEAD_ID,
      answers: [answer(C1, true, true), answer(C2, "slab", false)],
      score: 60,
      reason: "Owns the home but the roof does not qualify.",
      icebreaker: "Vi que você mora aí há anos.",
    });

    expect(result.ok).toBe(true);
    expect(await answersFor(ATTEMPT_ID)).toHaveLength(2);

    const lead = await leadRow();
    expect(lead.score).toBe(60);
    expect(lead.qualificationReason).toContain("Owns the home");
    expect(lead.icebreaker).toContain("mora aí");

    const attempt = await attemptRow();
    expect(attempt.scoringStatus).toBe("done");
    expect(attempt.scoredAt).not.toBeNull();
  });

  it("upserts rather than appending, so a retried run cannot mix two executions", async () => {
    const first = { attemptId: ATTEMPT_ID, leadId: LEAD_ID, score: 60, reason: "first", icebreaker: null };
    await saveScoringResult(db, { ...first, answers: [answer(C1, true, true), answer(C2, "slab", false)] });
    await saveScoringResult(db, {
      ...first,
      score: 100,
      reason: "second",
      answers: [answer(C1, true, true, 0.4), answer(C2, "ceramic", true)],
    });

    const rows = await answersFor(ATTEMPT_ID);
    expect(rows).toHaveLength(2);

    const roof = rows.find((r) => r.criteriaId === C2)!;
    expect(roof.normalizedValue).toBe("ceramic");
    expect(roof.passed).toBe(true);

    const home = rows.find((r) => r.criteriaId === C1)!;
    expect(Number(home.confidence)).toBeCloseTo(0.4);
    expect((await leadRow()).score).toBe(100);
  });

  it("removes an answer whose criterion was not part of this run", async () => {
    const base = { attemptId: ATTEMPT_ID, leadId: LEAD_ID, score: 60, reason: "r", icebreaker: null };
    await saveScoringResult(db, { ...base, answers: [answer(C1, true, true), answer(C2, "slab", false)] });
    await saveScoringResult(db, { ...base, answers: [answer(C1, true, true)] });

    const rows = await answersFor(ATTEMPT_ID);
    expect(rows.map((r) => r.criteriaId)).toEqual([C1]);
  });

  it("rolls back everything when a write fails part-way", async () => {
    const before = await leadRow();

    await expect(
      saveScoringResult(db, {
        attemptId: ATTEMPT_ID,
        leadId: LEAD_ID,
        // The second answer points at a criterion that does not exist, so the
        // foreign key rejects it after the first has been written.
        answers: [answer(C1, true, true), answer(MISSING, "x", false)],
        score: 99,
        reason: "should not survive",
        icebreaker: null,
      }),
    ).rejects.toThrow();

    expect(await answersFor(ATTEMPT_ID)).toHaveLength(0);
    const after = await leadRow();
    expect(after.score).toBe(before.score);
    expect(after.qualificationReason).toBe(before.qualificationReason);
    expect((await attemptRow()).scoredAt).toBeNull();
  });

  it("applies the lifecycle transition under the row lock", async () => {
    const result = await saveScoringResult(db, {
      attemptId: ATTEMPT_ID,
      leadId: LEAD_ID,
      answers: [answer(C1, true, true)],
      score: 85,
      reason: "r",
      icebreaker: "i",
      event: { type: "attempt_ended", outcome: "answered_complete", attemptCount: 1, decision: "qualified" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lead.status).toBe("qualified");
    expect((await leadRow()).nextCallAt).toBeNull();
  });

  it("refuses a transition the pure table rejects, without writing anything", async () => {
    await db.update(leads).set({ status: "opt_out" }).where(eq(leads.id, LEAD_ID));

    const result = await saveScoringResult(db, {
      attemptId: ATTEMPT_ID,
      leadId: LEAD_ID,
      answers: [answer(C1, true, true)],
      score: 85,
      reason: "r",
      icebreaker: "i",
      event: { type: "attempt_ended", outcome: "answered_complete", attemptCount: 1, decision: "qualified" },
    });

    expect(result.ok).toBe(false);
    expect(await answersFor(ATTEMPT_ID)).toHaveLength(0);
    expect((await leadRow()).status).toBe("opt_out");
  });

  it("re-scores without an event, leaving the status alone", async () => {
    await db.update(leads).set({ status: "qualified" }).where(eq(leads.id, LEAD_ID));

    const result = await saveScoringResult(db, {
      attemptId: ATTEMPT_ID,
      leadId: LEAD_ID,
      answers: [answer(C1, true, true)],
      score: 42,
      reason: "re-scored",
      icebreaker: null,
    });

    expect(result.ok).toBe(true);
    const lead = await leadRow();
    expect(lead.status).toBe("qualified");
    expect(lead.score).toBe(42);
  });
});

describe("loadAttemptForScoring", () => {
  beforeEach(seed);

  it("returns the attempt, its lead and the live criteria", async () => {
    const loaded = await loadAttemptForScoring(db, ATTEMPT_ID);
    expect(loaded).not.toBeNull();
    expect(loaded!.lead.name).toBe("Maria");
    expect(loaded!.criteria.map((c) => c.key).sort()).toEqual(["homeowner", "roof_type"]);
    expect(loaded!.suppressOutreach).toBe(false);
  });

  it("suppresses outreach for an opted-out lead", async () => {
    await db.update(leads).set({ status: "opt_out" }).where(eq(leads.id, LEAD_ID));
    const loaded = await loadAttemptForScoring(db, ATTEMPT_ID);
    expect(loaded!.suppressOutreach).toBe(true);
  });

  it("returns null for an unknown attempt", async () => {
    expect(await loadAttemptForScoring(db, MISSING)).toBeNull();
  });
});

describe("listScoringPendings", () => {
  beforeEach(seed);

  it("lists only attempts whose scoring failed", async () => {
    expect(await listScoringPendings(db)).toHaveLength(0);
    await setScoringStatus(db, ATTEMPT_ID, "failed");

    const pendings = await listScoringPendings(db);
    expect(pendings).toHaveLength(1);
    expect(pendings[0]).toMatchObject({ attemptId: ATTEMPT_ID, leadName: "Maria", attemptNumber: 1 });
  });
});
