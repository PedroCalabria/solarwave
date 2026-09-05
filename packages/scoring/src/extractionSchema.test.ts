import { evaluateAnswer, scoreLead, type ScoringCriterion } from "@solarwave/core";
import { describe, expect, it } from "vitest";
import { buildExtractionSchema, vocabularyFor, type ExtractionCriterion } from "./extractionSchema";

const timeline: ExtractionCriterion = {
  key: "purchase_timeline",
  label: "Purchase timeline",
  type: "enum",
  options: "this_month|within_3_months|within_6_months|not_sure",
  expectedValue: "this_month|within_3_months",
  active: true,
};

const homeowner: ExtractionCriterion = {
  key: "homeowner",
  label: "Homeowner",
  type: "boolean",
  options: null,
  expectedValue: "true",
  active: true,
};

const bill: ExtractionCriterion = {
  key: "monthly_bill",
  label: "Monthly bill",
  type: "numeric",
  options: null,
  expectedValue: ">= 300",
  active: true,
};

const notes: ExtractionCriterion = {
  key: "notes",
  label: "Notes",
  type: "free_text",
  options: null,
  expectedValue: null,
  active: true,
};

const unwrap = (criteria: ExtractionCriterion[]) => {
  const built = buildExtractionSchema(criteria);
  if (!built.ok) throw new Error(`expected a schema, got ${JSON.stringify(built.error)}`);
  return built.value;
};

const answer = (value: unknown) => ({ value, confidence: 0.9, evidence: "quoted" });

describe("buildExtractionSchema", () => {
  it("constrains an enum to its vocabulary, not to what passes", () => {
    const { schema } = unwrap([timeline]);

    // Every vocabulary member parses, including the one that no longer passes.
    for (const value of vocabularyFor(timeline)) {
      expect(schema.safeParse({ purchase_timeline: answer(value) }).success).toBe(true);
    }
    // A phrase outside the vocabulary does not.
    expect(schema.safeParse({ purchase_timeline: answer("esse mes mesmo") }).success).toBe(false);
  });

  it("keeps a failing enum answer representable", () => {
    // The seeded James answers within_6_months on a criterion that only passes
    // this_month|within_3_months. Constraining the schema to expected_value
    // would make this unrepresentable and no enum criterion could ever fail.
    const { schema } = unwrap([timeline]);
    expect(schema.safeParse({ purchase_timeline: answer("within_6_months") }).success).toBe(true);

    const scoringCriterion: ScoringCriterion = {
      key: timeline.key,
      type: timeline.type,
      expectedValue: timeline.expectedValue,
      weight: 20,
      blocking: false,
      active: true,
    };
    const passed = evaluateAnswer(scoringCriterion, "within_6_months");
    expect(passed.ok && passed.value).toBe(false);
  });

  it("maps each type to its value shape", () => {
    const { schema, keys } = unwrap([homeowner, bill, notes]);
    expect(keys).toEqual(["homeowner", "monthly_bill", "notes"]);

    expect(
      schema.safeParse({ homeowner: answer(true), monthly_bill: answer(720), notes: answer("wants battery") }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ homeowner: answer("yes"), monthly_bill: answer(720), notes: answer("x") }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ homeowner: answer(true), monthly_bill: answer("720"), notes: answer("x") }).success,
    ).toBe(false);
  });

  it("allows a null value for a criterion that was never discussed", () => {
    const { schema } = unwrap([timeline, homeowner]);
    expect(
      schema.safeParse({ purchase_timeline: { value: null, confidence: 0, evidence: "" }, homeowner: answer(true) })
        .success,
    ).toBe(true);
  });

  it("requires confidence and evidence on every answer", () => {
    const { schema } = unwrap([homeowner]);
    expect(schema.safeParse({ homeowner: { value: true, confidence: 0.5 } }).success).toBe(false);
    expect(schema.safeParse({ homeowner: { value: true, evidence: "q" } }).success).toBe(false);
    expect(schema.safeParse({ homeowner: { value: true, confidence: "high", evidence: "q" } }).success).toBe(false);
  });

  it("does not fail an extraction over an out-of-range confidence", () => {
    // Confidence never touches the score, so the schema stays permissive and
    // the extractor clamps. Losing a whole extraction over 1.2 is a bad trade.
    const { schema } = unwrap([homeowner]);
    expect(schema.safeParse({ homeowner: { value: true, confidence: 1.4, evidence: "q" } }).success).toBe(true);
  });

  it("omits inactive criteria", () => {
    const { schema, keys } = unwrap([homeowner, { ...bill, active: false }]);
    expect(keys).toEqual(["homeowner"]);
    expect(schema.safeParse({ homeowner: answer(true), monthly_bill: answer(720) }).success).toBe(true);
    expect(Object.keys((schema as z0).shape ?? {})).toEqual(["homeowner"]);
  });

  it("fails with a criterion-naming error before any model call when a rule is malformed", () => {
    const built = buildExtractionSchema([{ ...bill, expectedValue: "lots" }]);
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.error[0]?.criterionKey).toBe("monthly_bill");
      expect(built.error[0]?.message).toContain(">= 300");
    }
  });

  it("fails when an active enum criterion has no vocabulary", () => {
    const built = buildExtractionSchema([{ ...timeline, options: null }]);
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.error.some((e) => e.criterionKey === "purchase_timeline" && e.message.includes("options"))).toBe(
        true,
      );
    }
  });

  it("ignores a misconfigured inactive criterion", () => {
    const built = buildExtractionSchema([homeowner, { ...timeline, options: null, active: false }]);
    expect(built.ok).toBe(true);
  });

  it("reports every misconfigured criterion at once", () => {
    const built = buildExtractionSchema([
      { ...bill, expectedValue: "lots" },
      { ...timeline, options: null },
    ]);
    expect(built.ok).toBe(false);
    if (!built.ok) expect(new Set(built.error.map((e) => e.criterionKey)).size).toBe(2);
  });

  it("narrowing expected_value changes the score without touching the schema", () => {
    const stored = [{ criterionKey: "purchase_timeline", value: "within_6_months" }];
    const base = { key: "purchase_timeline", type: "enum" as const, weight: 100, blocking: false, active: true };
    const settings = { handoffThreshold: 70, minAnsweredWeightShare: 0.6 };

    const wide = scoreLead({
      criteria: [{ ...base, expectedValue: "this_month|within_3_months|within_6_months" }],
      answers: stored,
      settings,
    });
    const narrow = scoreLead({
      criteria: [{ ...base, expectedValue: "this_month|within_3_months" }],
      answers: stored,
      settings,
    });

    expect(wide.ok && wide.value.score).toBe(100);
    expect(narrow.ok && narrow.value.score).toBe(0);
  });
});

/** Minimal structural view of a zod object, to assert on the generated shape. */
type z0 = { shape?: Record<string, unknown> };
