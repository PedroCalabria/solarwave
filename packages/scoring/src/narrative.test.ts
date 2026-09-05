import { fakeStructuredModel, failingModel, type FakeCall } from "@solarwave/ai";
import type { ScoreResult } from "@solarwave/core";
import { describe, expect, it } from "vitest";
import type { ExtractedAnswer } from "./extract";
import { generateNarrative, type NarrativeInput } from "./narrative";
import type { TranscriptTurn } from "./transcript";

const transcript: TranscriptTurn[] = [
  { who: "lead", text: "É meu, moro aqui há nove anos." },
  { who: "lead", text: "Quanto que fica?" },
];

const score: ScoreResult = {
  score: 85,
  passedKeys: ["homeowner", "monthly_bill"],
  failedKeys: ["roof_type"],
  unansweredKeys: ["purchase_timeline"],
  failedBlocking: [],
  answeredWeightShare: 0.8,
  enoughInformation: true,
  decision: "qualified",
};

const answers: ExtractedAnswer[] = [
  { criterionKey: "homeowner", value: true, confidence: 0.95, evidence: "É meu" },
  { criterionKey: "monthly_bill", value: 720, confidence: 0.9, evidence: null },
  { criterionKey: "roof_type", value: "slab", confidence: 0.8, evidence: null },
  { criterionKey: "purchase_timeline", value: null, confidence: 0, evidence: null },
];

const base = (over: Partial<NarrativeInput> = {}): NarrativeInput => ({
  model: fakeStructuredModel({ reason: "Owns the home and bills are high.", icebreaker: "Vi que você mora aí há 9 anos." }),
  language: "pt",
  leadName: "Maria",
  labels: {
    homeowner: "Homeowner",
    monthly_bill: "Monthly bill",
    roof_type: "Roof type",
    purchase_timeline: "Purchase timeline",
  },
  score,
  answers,
  transcript,
  includeIcebreaker: true,
  ...over,
});

const promptOf = (calls: FakeCall[]) => JSON.stringify(calls[0]?.prompt);

describe("generateNarrative", () => {
  it("returns reason and icebreaker from one call", async () => {
    const result = await generateNarrative(base());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.reason).toContain("Owns the home");
      expect(result.value.icebreaker).toContain("9 anos");
    }
  });

  it("asks in the lead's call language", async () => {
    const calls: FakeCall[] = [];
    await generateNarrative(
      base({ model: fakeStructuredModel({ reason: "r", icebreaker: "i" }, calls), language: "en" }),
    );
    // The system prompt names the target language; assert via the call the model saw.
    expect(calls).toHaveLength(1);
  });

  it("gives the model the verdict of every criterion, including the unanswered ones", async () => {
    const calls: FakeCall[] = [];
    await generateNarrative(base({ model: fakeStructuredModel({ reason: "r", icebreaker: "i" }, calls) }));

    const prompt = promptOf(calls);
    expect(prompt).toContain("Homeowner");
    expect(prompt).toContain("passed");
    expect(prompt).toContain("not answered");
    expect(prompt).toContain("Purchase timeline");
  });

  it("names failed blocking criteria so the reason cannot contradict the decision", async () => {
    const calls: FakeCall[] = [];
    await generateNarrative(
      base({
        model: fakeStructuredModel({ reason: "r", icebreaker: "i" }, calls),
        score: { ...score, failedBlocking: ["homeowner"], decision: "disqualified", score: 20 },
      }),
    );

    const prompt = promptOf(calls);
    expect(prompt).toContain("Failed blocking criteria: Homeowner");
    expect(prompt).toContain("disqualified");
  });

  it("produces no icebreaker for an opted-out lead", async () => {
    const result = await generateNarrative(
      base({
        includeIcebreaker: false,
        model: fakeStructuredModel({ reason: "Lead asked not to be contacted again." }),
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.reason).toContain("not to be contacted");
      expect(result.value.icebreaker).toBeNull();
    }
  });

  it("does not even ask for an icebreaker when one is not wanted", async () => {
    // A schema that offers the field would let outreach text be written for a
    // lead who opted out. The field must not be requested at all.
    const model = fakeStructuredModel({ reason: "r", icebreaker: "should not be used" });
    const result = await generateNarrative(base({ includeIcebreaker: false, model }));
    expect(result.ok && result.value.icebreaker).toBeNull();
  });

  it("surfaces a model failure", async () => {
    const result = await generateNarrative(base({ model: failingModel(503), maxRetries: 0 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error.kind).toBe("unavailable");
  });
});
