import { fakeStructuredModel, failingModel, type FakeCall } from "@solarwave/ai";
import { describe, expect, it } from "vitest";
import { extractAnswers, extractCall } from "./extract";
import { CALLBACK_KEY, type ExtractionCriterion } from "./extractionSchema";
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

describe("extractCall — the requested callback", () => {
  const context = { timezone: "America/Sao_Paulo", endedAt: new Date("2026-09-06T17:30:00Z") };
  const base = {
    homeowner: answer(true, "É meu, moro aqui há nove anos."),
    monthly_bill: answer(720, "Veio setecentos e vinte."),
    purchase_timeline: answer(null, ""),
  };

  it("asks for nothing when no context is supplied", async () => {
    const calls: FakeCall[] = [];
    const result = await extractCall({
      criteria,
      transcript,
      model: fakeStructuredModel(base, calls),
    });

    expect(result.ok && result.value.callback).toBeNull();
    expect(JSON.stringify(calls)).not.toContain(CALLBACK_KEY);
  });

  it("resolves a local wall clock in the lead's timezone", async () => {
    const result = await extractCall({
      criteria,
      transcript,
      callback: context,
      model: fakeStructuredModel({
        ...base,
        [CALLBACK_KEY]: { said: "me liga amanhã de manhã", local_datetime: "2026-09-07T09:00" },
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.callback?.said).toBe("me liga amanhã de manhã");
    // 09:00 in Sao Paulo (UTC-3) is 12:00 UTC. The conversion stays in code.
    expect(result.value.callback?.at?.toISOString()).toBe("2026-09-07T12:00:00.000Z");
  });

  it("tells the model when the call happened, so 'tomorrow' means something", async () => {
    const calls: FakeCall[] = [];
    await extractCall({
      criteria,
      transcript,
      callback: context,
      model: fakeStructuredModel(base, calls),
    });

    // 17:30 UTC is 14:30 local in Sao Paulo.
    expect(JSON.stringify(calls)).toContain("2026-09-06T14:30");
    expect(JSON.stringify(calls)).toContain("America/Sao_Paulo");
  });

  it("keeps the words when the time could not be placed on a clock", async () => {
    // The phrase is stored either way, so a person can see what was asked for
    // and that the standard retry applied.
    const result = await extractCall({
      criteria,
      transcript,
      callback: context,
      model: fakeStructuredModel({
        ...base,
        [CALLBACK_KEY]: { said: "me liga qualquer hora dessas", local_datetime: null },
      }),
    });

    expect(result.ok && result.value.callback).toEqual({ said: "me liga qualquer hora dessas", at: null });
  });

  it("reports no callback when the lead asked for nothing", async () => {
    const result = await extractCall({
      criteria,
      transcript,
      callback: context,
      model: fakeStructuredModel({ ...base, [CALLBACK_KEY]: { said: "", local_datetime: null } }),
    });

    expect(result.ok && result.value.callback).toBeNull();
  });

  it("survives the field being omitted entirely", async () => {
    // Change 3 measured this model omitting fields it was asked for, and change
    // 4 measured it omitting required tool arguments. The answers must not care.
    const result = await extractCall({ criteria, transcript, callback: context, model: fakeStructuredModel(base) });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.callback).toBeNull();
    expect(result.value.answers).toHaveLength(3);
    expect(result.value.answers[0]).toMatchObject({ value: true });
  });

  it("refuses a malformed datetime rather than inventing one", async () => {
    for (const local_datetime of ["tomorrow", "2026-13-01T09:00", "2026-09-07", "2026-09-07T99:00", ""]) {
      const result = await extractCall({
        criteria,
        transcript,
        callback: context,
        model: fakeStructuredModel({ ...base, [CALLBACK_KEY]: { said: "amanhã", local_datetime } }),
      });
      expect(result.ok && result.value.callback?.at, local_datetime).toBeNull();
    }
  });

  it("never lets a bad callback cost the criteria answers", async () => {
    const result = await extractCall({
      criteria,
      transcript,
      callback: context,
      model: fakeStructuredModel({ ...base, [CALLBACK_KEY]: "not an object" }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.callback).toBeNull();
    expect(result.value.answers.map((a) => a.criterionKey)).toEqual([
      "homeowner",
      "monthly_bill",
      "purchase_timeline",
    ]);
  });

  it("yields the reserved key to a criterion that has taken it", async () => {
    const collided: ExtractionCriterion[] = [
      { key: CALLBACK_KEY, label: "Odd criterion", type: "boolean", options: null, expectedValue: "true", active: true },
    ];
    const calls: FakeCall[] = [];
    const result = await extractCall({
      criteria: collided,
      transcript,
      callback: context,
      model: fakeStructuredModel({ [CALLBACK_KEY]: answer(true, "É meu, moro aqui há nove anos.") }, calls),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The criterion wins: a real criterion going missing is the worse failure.
    expect(result.value.answers.map((a) => a.criterionKey)).toEqual([CALLBACK_KEY]);
    expect(result.value.callback).toBeNull();
  });
});
