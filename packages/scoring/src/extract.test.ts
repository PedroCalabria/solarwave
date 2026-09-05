import { fakeStructuredModel, failingModel, type FakeCall } from "@solarwave/ai";
import { describe, expect, it } from "vitest";
import { extractAnswers } from "./extract";
import type { ExtractionCriterion } from "./extractionSchema";
import type { TranscriptTurn } from "./transcript";

const criteria: ExtractionCriterion[] = [
  { key: "homeowner", label: "Homeowner", type: "boolean", options: null, expectedValue: "true", active: true },
  { key: "monthly_bill", label: "Monthly bill", type: "numeric", options: null, expectedValue: ">= 300", active: true },
  {
    key: "purchase_timeline",
    label: "Purchase timeline",
    type: "enum",
    options: "this_month|within_3_months|within_6_months|not_sure",
    expectedValue: "this_month|within_3_months",
    active: true,
  },
];

const transcript: TranscriptTurn[] = [
  { who: "ai", text: "O imóvel é seu ou alugado?" },
  { who: "lead", text: "É meu, moro aqui há nove anos." },
  { who: "ai", text: "Qual foi o valor da última conta?" },
  { who: "lead", text: "Veio setecentos e vinte." },
];

const answer = (value: unknown, evidence: string, confidence = 0.9) => ({ value, confidence, evidence });

describe("extractAnswers", () => {
  it("returns one answer per active criterion, in schema order", async () => {
    const result = await extractAnswers({
      criteria,
      transcript,
      model: fakeStructuredModel({
        homeowner: answer(true, "É meu, moro aqui há nove anos."),
        monthly_bill: answer(720, "Veio setecentos e vinte."),
        purchase_timeline: answer(null, ""),
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((a) => a.criterionKey)).toEqual(["homeowner", "monthly_bill", "purchase_timeline"]);
    expect(result.value[0]).toMatchObject({ value: true, confidence: 0.9 });
    expect(result.value[1]).toMatchObject({ value: 720 });
    expect(result.value[2]).toMatchObject({ value: null, evidence: null });
  });

  it("keeps evidence that is genuinely quoted", async () => {
    const result = await extractAnswers({
      criteria: [criteria[0]!],
      transcript,
      model: fakeStructuredModel({ homeowner: answer(true, "moro aqui há nove anos") }),
    });

    expect(result.ok && result.value[0]?.evidence).toBe("moro aqui há nove anos");
  });

  it("drops evidence the model paraphrased rather than quoted", async () => {
    const result = await extractAnswers({
      criteria: [criteria[0]!],
      transcript,
      model: fakeStructuredModel({ homeowner: answer(true, "The lead confirmed they own the home.") }),
    });

    // The answer survives; the unverifiable quote does not, because the portal
    // presents evidence as the lead's own words.
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]?.value).toBe(true);
      expect(result.value[0]?.evidence).toBeNull();
    }
  });

  it("clamps a confidence the model returned out of range", async () => {
    const result = await extractAnswers({
      criteria: [criteria[0]!],
      transcript,
      model: fakeStructuredModel({ homeowner: answer(true, "É meu", 4.2) }),
    });

    expect(result.ok && result.value[0]?.confidence).toBe(1);
  });

  it("refuses malformed criteria before calling the model", async () => {
    // The fake records every call it receives, so an empty log proves no token
    // was spent on a criterion set that could never have been scored.
    const calls: FakeCall[] = [];
    const result = await extractAnswers({
      criteria: [{ ...criteria[1]!, expectedValue: "lots" }],
      transcript,
      model: fakeStructuredModel({}, calls),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_criteria");
    expect(calls).toHaveLength(0);
  });

  it("refuses an enum criterion with no vocabulary before calling the model", async () => {
    const result = await extractAnswers({
      criteria: [{ ...criteria[2]!, options: null }],
      transcript,
      model: fakeStructuredModel({}),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_criteria");
  });

  it("refuses an empty transcript", async () => {
    const result = await extractAnswers({ criteria, transcript: [], model: fakeStructuredModel({}) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("no_transcript");
  });

  it("surfaces a model failure as a model error", async () => {
    const result = await extractAnswers({
      criteria: [criteria[0]!],
      transcript,
      model: failingModel(429),
      maxRetries: 0,
    });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "model") expect(result.error.error.kind).toBe("rate_limited");
  });

  it("names the enum vocabulary in the prompt so the model can only pick a member", async () => {
    const calls: FakeCall[] = [];
    const result = await extractAnswers({
      criteria: [criteria[2]!],
      transcript,
      model: fakeStructuredModel({ purchase_timeline: answer("within_6_months", "Veio setecentos e vinte.") }, calls),
    });

    expect(JSON.stringify(calls[0]?.prompt)).toContain("within_6_months");
    // A value that fails the rule is still extracted, never coerced to null.
    expect(result.ok && result.value[0]?.value).toBe("within_6_months");
  });
});
