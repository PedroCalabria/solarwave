import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client";
import { callAttempts, criteriaAuditLog, employees, leads, qualificationCriteria, settings } from "../schema";
import { openTestDb } from "../test/harness";
import { auditChangesSince, latestCriteriaChangeAt } from "./audit";
import { loadAnswerRows, saveScoringResult } from "./attempts";

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
const ADMIN = "55555555-5555-5555-5555-555555555555";
const TIMELINE = "33333333-3333-3333-3333-333333333331";

async function seed() {
  await db.insert(employees).values({ id: ADMIN, name: "Ana", email: "ana@example.com", role: "admin" });
  await db.insert(leads).values({
    id: LEAD_ID,
    name: "James",
    email: "james@example.com",
    phone: "+5511988888888",
    ddd: "11",
    timezone: "America/Sao_Paulo",
    status: "calling",
  });
  await db.insert(callAttempts).values({
    id: ATTEMPT_ID,
    leadId: LEAD_ID,
    attemptNumber: 1,
    scheduledAt: new Date("2026-09-01T12:00:00Z"),
    transcript: [{ who: "lead", text: "Probably in the next four to six months." }],
  });
  await db.insert(qualificationCriteria).values({
    id: TIMELINE,
    key: "purchase_timeline",
    label: "Purchase timeline",
    questionPt: "?",
    questionEn: "?",
    type: "enum",
    options: "this_month|within_3_months|within_6_months",
    expectedValue: "this_month|within_3_months|within_6_months",
    weight: 100,
  });
  await db.insert(settings).values([
    { key: "handoff_threshold", value: 70 },
    { key: "min_answered_weight_share", value: 0.6 },
  ]);
}

describe("audit-driven staleness inputs", () => {
  beforeEach(seed);

  it("returns nothing when no change is newer than the score", async () => {
    await db.insert(criteriaAuditLog).values({
      criteriaId: TIMELINE,
      changedBy: ADMIN,
      field: "weight",
      oldValue: "80",
      newValue: "100",
      changedAt: new Date("2026-08-01T00:00:00Z"),
    });

    expect(await auditChangesSince(db, new Date("2026-09-01T00:00:00Z"))).toHaveLength(0);
  });

  it("returns criteria and settings changes newer than the score, newest first", async () => {
    await db.insert(criteriaAuditLog).values([
      {
        criteriaId: TIMELINE,
        changedBy: ADMIN,
        field: "expectedValue",
        oldValue: "this_month|within_3_months|within_6_months",
        newValue: "this_month|within_3_months",
        changedAt: new Date("2026-09-02T10:00:00Z"),
      },
      {
        criteriaId: null,
        changedBy: ADMIN,
        field: "setting:handoff_threshold",
        oldValue: "70",
        newValue: "60",
        changedAt: new Date("2026-09-03T10:00:00Z"),
      },
    ]);

    const changes = await auditChangesSince(db, new Date("2026-09-01T00:00:00Z"));
    expect(changes.map((c) => c.field)).toEqual(["setting:handoff_threshold", "expectedValue"]);
    expect(await latestCriteriaChangeAt(db)).toEqual(new Date("2026-09-03T10:00:00Z"));
  });

  it("reports no change at all on a fresh database", async () => {
    expect(await latestCriteriaChangeAt(db)).toBeNull();
  });
});

describe("loadAnswerRows", () => {
  beforeEach(seed);

  it("returns stored answers with their criterion key and preserved metadata", async () => {
    await saveScoringResult(db, {
      attemptId: ATTEMPT_ID,
      leadId: LEAD_ID,
      answers: [
        {
          criteriaId: TIMELINE,
          extractedValue: "within_6_months",
          normalizedValue: "within_6_months",
          confidence: 0.82,
          evidence: "Probably in the next four to six months.",
          passed: true,
        },
      ],
      score: 100,
      reason: "Timeline works.",
      icebreaker: "Saw you are planning ahead.",
    });

    const rows = await loadAnswerRows(db, ATTEMPT_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      criterionKey: "purchase_timeline",
      normalizedValue: "within_6_months",
      passed: true,
    });
    expect(rows[0]!.confidence).toBeCloseTo(0.82);
    expect(rows[0]!.evidence).toContain("four to six months");
  });

  it("narrowing what passes flips the verdict on a re-score, with no transcript read", async () => {
    await saveScoringResult(db, {
      attemptId: ATTEMPT_ID,
      leadId: LEAD_ID,
      answers: [
        {
          criteriaId: TIMELINE,
          extractedValue: "within_6_months",
          normalizedValue: "within_6_months",
          confidence: 0.82,
          evidence: "Probably in the next four to six months.",
          passed: true,
        },
      ],
      score: 100,
      reason: "r",
      icebreaker: null,
    });

    // The seeded 2026-08-21 change: within_6_months stops passing, but is still
    // a member of the vocabulary and is still what the lead said.
    await db
      .update(qualificationCriteria)
      .set({ expectedValue: "this_month|within_3_months" })
      .where(eq(qualificationCriteria.id, TIMELINE));

    const rows = await loadAnswerRows(db, ATTEMPT_ID);
    expect(rows[0]!.normalizedValue).toBe("within_6_months");
    // The stored value survived the rule change untouched; only the verdict a
    // re-score computes from it will differ.
    expect(rows[0]!.evidence).toContain("four to six months");
  });
});
