import type { AttemptForScoring, Criterion } from "@solarwave/db";
import { describe, expect, it } from "vitest";
import type { ExtractedAnswer } from "./extract";
import { toAnswerRows, transitionEvent } from "./worker";

const criterion = (over: Partial<Criterion> & Pick<Criterion, "id" | "key">): Criterion =>
  ({
    label: over.key,
    questionPt: "?",
    questionEn: "?",
    type: "boolean",
    options: null,
    expectedValue: "true",
    weight: 30,
    blocking: false,
    active: true,
    sortOrder: 0,
    deletedAt: null,
    updatedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as Criterion;

const CRITERIA: Criterion[] = [
  criterion({ id: "c1", key: "homeowner", blocking: true }),
  criterion({ id: "c2", key: "monthly_bill", type: "numeric", expectedValue: ">= 300", weight: 25 }),
  criterion({
    id: "c3",
    key: "purchase_timeline",
    type: "enum",
    options: "this_month|within_3_months|within_6_months",
    expectedValue: "this_month|within_3_months",
    weight: 20,
  }),
];

const answer = (criterionKey: string, value: ExtractedAnswer["value"]): ExtractedAnswer => ({
  criterionKey,
  value,
  confidence: 0.9,
  evidence: "quoted",
});

describe("toAnswerRows", () => {
  it("resolves each answer to its criterion id and pass verdict", () => {
    const { rows, errors } = toAnswerRows(
      [answer("homeowner", true), answer("monthly_bill", 720), answer("purchase_timeline", "within_6_months")],
      CRITERIA,
    );

    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.criteriaId, r.passed])).toEqual([
      ["c1", true],
      ["c2", true],
      // In the vocabulary, outside what passes: extracted, and correctly failed.
      ["c3", false],
    ]);
  });

  it("stores the typed value and a readable rendering of it", () => {
    const { rows } = toAnswerRows([answer("monthly_bill", 720)], CRITERIA);
    expect(rows[0]).toMatchObject({ normalizedValue: 720, extractedValue: "720" });
  });

  it("leaves passed null for a criterion that was never answered", () => {
    const { rows } = toAnswerRows([answer("homeowner", null)], CRITERIA);
    expect(rows[0]).toMatchObject({ passed: null, extractedValue: null });
  });

  it("ignores an answer for a criterion that no longer exists", () => {
    const { rows, errors } = toAnswerRows([answer("removed_criterion", true)], CRITERIA);
    expect(rows).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("reports a malformed rule instead of guessing a verdict", () => {
    const broken = [criterion({ id: "c9", key: "bill", type: "numeric", expectedValue: "lots" })];
    const { rows, errors } = toAnswerRows([answer("bill", 100)], broken);
    expect(rows).toEqual([]);
    expect(errors[0]?.criterionKey).toBe("bill");
  });
});

const loaded = (outcome: string | null, leadStatus: string, attemptNumber = 1): AttemptForScoring =>
  ({
    attempt: { outcome, attemptNumber },
    lead: { status: leadStatus },
    criteria: CRITERIA,
    suppressOutreach: false,
  }) as unknown as AttemptForScoring;

describe("transitionEvent", () => {
  it("moves a calling lead on a completed call, carrying the decision", () => {
    expect(transitionEvent(loaded("answered_complete", "calling", 2), "qualified")).toEqual({
      type: "attempt_ended",
      outcome: "answered_complete",
      attemptCount: 2,
      decision: "qualified",
    });
  });

  it("does not replay the lifecycle when re-scoring a lead that already qualified", () => {
    expect(transitionEvent(loaded("answered_complete", "qualified"), "disqualified")).toBeUndefined();
  });

  it("never moves a lead that opted out", () => {
    expect(transitionEvent(loaded("answered_complete", "opt_out"), "qualified")).toBeUndefined();
  });

  it("does not transition an attempt that did not complete", () => {
    expect(transitionEvent(loaded("answered_incomplete", "calling"), "disqualified")).toBeUndefined();
    expect(transitionEvent(loaded("no_answer", "calling"), "disqualified")).toBeUndefined();
    expect(transitionEvent(loaded(null, "calling"), "qualified")).toBeUndefined();
  });
});
