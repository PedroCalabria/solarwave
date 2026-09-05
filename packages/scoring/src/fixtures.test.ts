import { fakeStructuredModel } from "@solarwave/ai";
import { describe, expect, it } from "vitest";
import { extractAnswers } from "./extract";
import { buildExtractionSchema } from "./extractionSchema";
import { GOLDEN_CASES, GOLDEN_CRITERIA, GOLDEN_TRANSCRIPTS, gradeExtraction } from "./fixtures";
import { isVerbatim } from "./transcript";

describe("golden fixtures", () => {
  it("carries the seeded transcripts and their expected answers", () => {
    expect(GOLDEN_CASES.length).toBeGreaterThan(0);
    expect(GOLDEN_TRANSCRIPTS.length).toBeGreaterThanOrEqual(GOLDEN_CASES.length);
    for (const c of GOLDEN_CASES) {
      expect(c.transcript.length).toBeGreaterThan(0);
      expect(Object.keys(c.expected).length).toBeGreaterThan(0);
    }
  });

  it("builds a valid extraction schema from the seeded criteria", () => {
    // If the seed ever ships a criterion the generator rejects, the eval and
    // the worker would both fail at runtime. Catch it here instead.
    const built = buildExtractionSchema(GOLDEN_CRITERIA);
    expect(built.ok).toBe(true);
  });

  it("expects a value that fails the rule, not just passing ones", () => {
    // The seeded James answers within_6_months on a criterion that no longer
    // accepts it. A golden set of only-passing answers would never catch the
    // vocabulary bug this change was built to fix.
    const values = GOLDEN_CASES.flatMap((c) => Object.values(c.expected));
    expect(values).toContain("within_6_months");
  });

  it("every seeded evidence quote really appears in its transcript", () => {
    for (const { transcript } of GOLDEN_TRANSCRIPTS) {
      for (const turn of transcript) expect(isVerbatim(turn.text, transcript)).toBe(true);
    }
  });
});

describe("gradeExtraction", () => {
  const keys = ["homeowner", "monthly_bill", "purchase_timeline"];

  it("scores an exact match as correct", () => {
    const scores = gradeExtraction({ homeowner: true, monthly_bill: 720, purchase_timeline: "this_month" }, [
      { criterionKey: "homeowner", value: true },
      { criterionKey: "monthly_bill", value: 720 },
      { criterionKey: "purchase_timeline", value: "this_month" },
    ], keys);

    expect(scores.every((s) => s.correct === 1)).toBe(true);
  });

  it("counts an invented answer as wrong", () => {
    // The golden case says nothing about the timeline, so the correct answer is
    // null. Making one up is as wrong as getting one wrong.
    const scores = gradeExtraction({ homeowner: true }, [
      { criterionKey: "homeowner", value: true },
      { criterionKey: "purchase_timeline", value: "this_month" },
    ], keys);

    expect(scores.find((s) => s.key === "purchase_timeline")?.correct).toBe(0);
    expect(scores.find((s) => s.key === "monthly_bill")?.correct).toBe(1);
  });

  it("is case and whitespace insensitive for enum values", () => {
    const scores = gradeExtraction({ purchase_timeline: "this_month" }, [
      { criterionKey: "purchase_timeline", value: " This_Month " },
    ], ["purchase_timeline"]);

    expect(scores[0]?.correct).toBe(1);
  });

  it("reports what was expected against what came back", () => {
    const scores = gradeExtraction({ monthly_bill: 720 }, [{ criterionKey: "monthly_bill", value: 340 }], [
      "monthly_bill",
    ]);
    expect(scores[0]?.misses[0]).toContain("expected 720");
    expect(scores[0]?.misses[0]).toContain("got 340");
  });
});

describe("the golden set runs through the extractor on mocks", () => {
  it("grades a perfect mocked extraction as perfect", async () => {
    const golden = GOLDEN_CASES[0]!;
    const active = GOLDEN_CRITERIA.filter((c) => c.active);
    const response = Object.fromEntries(
      active.map((c) => [
        c.key,
        { value: c.key in golden.expected ? golden.expected[c.key] : null, confidence: 0.9, evidence: "" },
      ]),
    );

    const result = await extractAnswers({
      criteria: GOLDEN_CRITERIA,
      transcript: golden.transcript,
      model: fakeStructuredModel(response),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const scores = gradeExtraction(
      golden.expected,
      result.value,
      active.map((c) => c.key),
    );
    expect(scores.every((s) => s.correct === 1)).toBe(true);
  });
});
