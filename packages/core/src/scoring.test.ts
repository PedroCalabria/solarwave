import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  evaluateAnswer,
  hasEnoughInformation,
  parseExpectedValue,
  scoreLead,
  type ScoringCriterion,
} from "./scoring";

const c = (partial: Partial<ScoringCriterion> & Pick<ScoringCriterion, "key">): ScoringCriterion => ({
  type: "boolean",
  expectedValue: "true",
  weight: 10,
  blocking: false,
  active: true,
  ...partial,
});

/** The five demo criteria, weights 30/25/20/15/10. */
const CRITERIA: ScoringCriterion[] = [
  c({ key: "homeowner", type: "boolean", expectedValue: "true", weight: 30, blocking: true }),
  c({ key: "bill", type: "numeric", expectedValue: ">= 300", weight: 25 }),
  c({ key: "timeline", type: "enum", expectedValue: "this_month|3_months", weight: 20 }),
  c({ key: "roof_type", type: "enum", expectedValue: "ceramic|metal", weight: 15 }),
  c({ key: "roof_area", type: "numeric", expectedValue: ">= 30", weight: 10 }),
];

describe("parseExpectedValue", () => {
  it("parses booleans", () => {
    expect(parseExpectedValue("boolean", "true")).toEqual({ ok: true, value: { kind: "boolean", expected: true } });
    expect(parseExpectedValue("boolean", "FALSE")).toEqual({ ok: true, value: { kind: "boolean", expected: false } });
    expect(parseExpectedValue("boolean", "yes").ok).toBe(false);
  });

  it("parses numeric comparators and ranges", () => {
    expect(parseExpectedValue("numeric", ">= 300")).toEqual({ ok: true, value: { kind: "numeric", op: ">=", value: 300 } });
    expect(parseExpectedValue("numeric", "<2000")).toEqual({ ok: true, value: { kind: "numeric", op: "<", value: 2000 } });
    expect(parseExpectedValue("numeric", "300..1500")).toEqual({ ok: true, value: { kind: "range", min: 300, max: 1500 } });
    expect(parseExpectedValue("numeric", "1500..300").ok).toBe(false);
    expect(parseExpectedValue("numeric", "lots").ok).toBe(false);
  });

  it("parses enum lists case-insensitively", () => {
    expect(parseExpectedValue("enum", "Ceramic | metal")).toEqual({
      ok: true,
      value: { kind: "enum", accepted: ["ceramic", "metal"] },
    });
    expect(parseExpectedValue("enum", " | ").ok).toBe(false);
  });

  it("free_text has no rule", () => {
    expect(parseExpectedValue("free_text", null)).toEqual({ ok: true, value: { kind: "any" } });
  });
});

describe("evaluateAnswer", () => {
  it("boolean match", () => {
    expect(evaluateAnswer(CRITERIA[0]!, true)).toEqual({ ok: true, value: true });
    expect(evaluateAnswer(CRITERIA[0]!, "false")).toEqual({ ok: true, value: false });
  });

  it("numeric comparator and range", () => {
    expect(evaluateAnswer(CRITERIA[1]!, 720)).toEqual({ ok: true, value: true });
    expect(evaluateAnswer(CRITERIA[1]!, "180")).toEqual({ ok: true, value: false });
    expect(evaluateAnswer(c({ key: "x", type: "numeric", expectedValue: "300..1500" }), 180)).toEqual({
      ok: true,
      value: false,
    });
  });

  it("enum list", () => {
    expect(evaluateAnswer(CRITERIA[3]!, "Metal")).toEqual({ ok: true, value: true });
    expect(evaluateAnswer(CRITERIA[3]!, "slab")).toEqual({ ok: true, value: false });
  });

  it("free text passes when answered", () => {
    const ft = c({ key: "notes", type: "free_text", expectedValue: null });
    expect(evaluateAnswer(ft, "has three quotes")).toEqual({ ok: true, value: true });
    expect(evaluateAnswer(ft, "")).toEqual({ ok: true, value: false });
    expect(evaluateAnswer(ft, null)).toEqual({ ok: true, value: false });
  });

  it("surfaces a malformed rule", () => {
    const r = evaluateAnswer(c({ key: "bad", type: "numeric", expectedValue: "lots" }), 5);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.criterionKey).toBe("bad");
  });
});

describe("scoreLead", () => {
  const allPass = [
    { criterionKey: "homeowner", value: true },
    { criterionKey: "bill", value: 720 },
    { criterionKey: "timeline", value: "this_month" },
    { criterionKey: "roof_type", value: "ceramic" },
    { criterionKey: "roof_area", value: 68 },
  ];

  it("scores 100 when everything passes and qualifies", () => {
    const r = scoreLead({ criteria: CRITERIA, answers: allPass, settings: DEFAULT_SETTINGS });
    expect(r.ok && r.value).toMatchObject({
      score: 100,
      decision: "qualified",
      failedBlocking: [],
      enoughInformation: true,
      answeredWeightShare: 1,
    });
  });

  it("normalises when weights do not sum to 100", () => {
    const criteria = [
      c({ key: "a", weight: 30 }),
      c({ key: "b", weight: 25 }),
      c({ key: "c", weight: 20 }),
    ];
    const answers = [
      { criterionKey: "a", value: true },
      { criterionKey: "b", value: false },
      { criterionKey: "c", value: true },
    ];
    const r = scoreLead({ criteria, answers, settings: DEFAULT_SETTINGS });
    expect(r.ok && r.value.score).toBe(67);
  });

  it("ignores inactive criteria entirely", () => {
    const criteria = [c({ key: "a", weight: 50 }), c({ key: "off", weight: 50, active: false })];
    const r = scoreLead({
      criteria,
      answers: [
        { criterionKey: "a", value: true },
        { criterionKey: "off", value: true },
      ],
      settings: DEFAULT_SETTINGS,
    });
    expect(r.ok && r.value.score).toBe(100);
    expect(r.ok && r.value.passedKeys).toEqual(["a"]);
  });

  it("counts an unanswered criterion in the denominator only", () => {
    const answers = allPass.filter((a) => a.criterionKey !== "roof_area");
    const r = scoreLead({ criteria: CRITERIA, answers, settings: DEFAULT_SETTINGS });
    expect(r.ok && r.value.score).toBe(90);
    expect(r.ok && r.value.unansweredKeys).toEqual(["roof_area"]);
    expect(r.ok && r.value.answeredWeightShare).toBeCloseTo(0.9);
  });

  it("a failed blocking criterion disqualifies regardless of score", () => {
    const answers = allPass.map((a) => (a.criterionKey === "homeowner" ? { ...a, value: false } : a));
    const r = scoreLead({ criteria: CRITERIA, answers, settings: DEFAULT_SETTINGS });
    expect(r.ok && r.value).toMatchObject({ score: 70, decision: "disqualified", failedBlocking: ["homeowner"] });
  });

  it("an unanswered blocking criterion means not enough information", () => {
    const answers = allPass.filter((a) => a.criterionKey !== "homeowner");
    const r = scoreLead({ criteria: CRITERIA, answers, settings: DEFAULT_SETTINGS });
    expect(r.ok && r.value.enoughInformation).toBe(false);
  });

  it("qualifies exactly at the threshold and not below", () => {
    // Pass homeowner(30)+bill(25)+roof_type(15) = 70
    const answers = [
      { criterionKey: "homeowner", value: true },
      { criterionKey: "bill", value: 500 },
      { criterionKey: "timeline", value: "next_year" },
      { criterionKey: "roof_type", value: "metal" },
      { criterionKey: "roof_area", value: 10 },
    ];
    const at70 = scoreLead({ criteria: CRITERIA, answers, settings: DEFAULT_SETTINGS });
    expect(at70.ok && at70.value).toMatchObject({ score: 70, decision: "qualified" });

    const strict = scoreLead({ criteria: CRITERIA, answers, settings: { ...DEFAULT_SETTINGS, handoffThreshold: 71 } });
    expect(strict.ok && strict.value.decision).toBe("disqualified");
  });

  it("re-running with a lower threshold flips the decision without new answers", () => {
    const answers = allPass.map((a) => (a.criterionKey === "bill" ? { ...a, value: 100 } : a)); // 75
    const answers65 = answers.map((a) => (a.criterionKey === "roof_area" ? { ...a, value: 5 } : a)); // 65
    const r70 = scoreLead({ criteria: CRITERIA, answers: answers65, settings: DEFAULT_SETTINGS });
    const r60 = scoreLead({ criteria: CRITERIA, answers: answers65, settings: { ...DEFAULT_SETTINGS, handoffThreshold: 60 } });
    expect(r70.ok && r70.value).toMatchObject({ score: 65, decision: "disqualified" });
    expect(r60.ok && r60.value).toMatchObject({ score: 65, decision: "qualified" });
  });

  it("is deterministic", () => {
    const a = scoreLead({ criteria: CRITERIA, answers: allPass, settings: DEFAULT_SETTINGS });
    const b = scoreLead({ criteria: CRITERIA, answers: allPass, settings: DEFAULT_SETTINGS });
    expect(a).toEqual(b);
  });

  it("returns validation errors for malformed active rules", () => {
    const criteria = [...CRITERIA, c({ key: "bad", type: "numeric", expectedValue: "lots" })];
    const r = scoreLead({ criteria, answers: allPass, settings: DEFAULT_SETTINGS });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error[0]?.criterionKey).toBe("bad");
  });
});

describe("hasEnoughInformation", () => {
  it("true when all blocking answered and share met", () => {
    const answers = [
      { criterionKey: "homeowner", value: true },
      { criterionKey: "bill", value: 300 },
      { criterionKey: "timeline", value: "x" },
    ]; // 75/100
    expect(hasEnoughInformation(CRITERIA, answers, 0.6)).toBe(true);
  });

  it("false when a blocking criterion is unanswered even with high share", () => {
    const answers = [
      { criterionKey: "bill", value: 300 },
      { criterionKey: "timeline", value: "x" },
      { criterionKey: "roof_type", value: "x" },
      { criterionKey: "roof_area", value: 1 },
    ]; // 70/100 but homeowner missing
    expect(hasEnoughInformation(CRITERIA, answers, 0.6)).toBe(false);
  });

  it("false when share is below the setting", () => {
    const answers = [{ criterionKey: "homeowner", value: true }, { criterionKey: "roof_area", value: 1 }]; // 40/100
    expect(hasEnoughInformation(CRITERIA, answers, 0.6)).toBe(false);
  });
});
