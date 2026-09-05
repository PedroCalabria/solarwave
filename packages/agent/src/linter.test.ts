import { fakeStructuredModel, failingModel, type LanguageModel } from "@solarwave/ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import { lintQuestions, type LintWarning } from "./linter";

const KEYED: NodeJS.ProcessEnv = { GOOGLE_GENERATIVE_AI_API_KEY: "test-key" };

const lint = (model: LanguageModel, over: Partial<Parameters<typeof lintQuestions>[0]> = {}) =>
  lintQuestions({
    model,
    label: "Homeowner verification",
    questionPt: "O imóvel é seu ou alugado?",
    questionEn: "Do you own the property or rent it?",
    env: KEYED,
    maxRetries: 0,
    ...over,
  });

const warns = (...warnings: LintWarning[]) => fakeStructuredModel({ warnings });

describe("lintQuestions", () => {
  it("returns nothing for a neutral, factual question", async () => {
    expect(await lint(warns())).toEqual([]);
  });

  it("reports a judgemental question", async () => {
    const warning: LintWarning = {
      field: "questionPt",
      concern: "tone",
      message: "Asks the lead to explain why they cannot afford the installation.",
    };

    expect(await lint(warns(warning), { questionPt: "Por que você não consegue pagar a instalação?" })).toEqual([
      warning,
    ]);
  });

  it("reports a question that collides with the sensitive-data guardrail", async () => {
    const warning: LintWarning = {
      field: "both",
      concern: "guardrail",
      message: "A credit pre-check needs a full national id number, which the agent must never ask for.",
    };

    const result = await lint(warns(warning), {
      questionPt: "Pode informar seu CPF completo para a análise de crédito?",
      questionEn: "Can you give your full national id for the credit check?",
    });

    expect(result).toEqual([warning]);
    expect(result[0]?.concern).toBe("guardrail");
  });

  it("reports a question that collides with the financial-advice guardrail", async () => {
    const warning: LintWarning = {
      field: "questionPt",
      concern: "guardrail",
      message: "Asking which financing plan the lead will use invites financial advice in the answer.",
    };

    expect(await lint(warns(warning), { questionPt: "Qual plano de financiamento você pretende usar?" })).toEqual([
      warning,
    ]);
  });

  it("reports a question that asks the lead to justify an answer", async () => {
    const warning: LintWarning = {
      field: "questionEn",
      concern: "justification",
      message: "Asks the lead to defend a negative answer.",
    };

    expect(await lint(warns(warning), { questionEn: "Why would you not want to install this year?" })).toEqual([
      warning,
    ]);
  });

  it("passes several warnings through", async () => {
    const a: LintWarning = { field: "questionPt", concern: "tone", message: "one" };
    const b: LintWarning = { field: "questionEn", concern: "guardrail", message: "two" };

    expect(await lint(warns(a, b))).toHaveLength(2);
  });

  describe("failing open", () => {
    it("returns nothing when no API key is configured, without calling the model", async () => {
      // The seed path and the integration tests deliberately run without a key,
      // and the portal has to stay usable there.
      let called = false;
      const model = new MockLanguageModelV3({
        doGenerate: async () => {
          called = true;
          throw new Error("should never be reached");
        },
      });

      expect(await lint(model as LanguageModel, { env: {} })).toEqual([]);
      expect(called).toBe(false);
    });

    it("returns nothing when the provider rate-limits the request", async () => {
      expect(await lint(failingModel(429))).toEqual([]);
    });

    it("returns nothing when the account cannot service requests", async () => {
      expect(await lint(failingModel(403, "requires a valid credit card on file"))).toEqual([]);
    });

    it("returns nothing when the model returns unusable output", async () => {
      expect(await lint(fakeStructuredModel({ warnings: "not an array" }))).toEqual([]);
    });

    it("returns nothing when the model throws something unexpected", async () => {
      const model = new MockLanguageModelV3({
        doGenerate: async () => {
          throw new Error("socket hang up");
        },
      });

      expect(await lint(model as LanguageModel)).toEqual([]);
    });

    it("never throws, whatever happens", async () => {
      await expect(lint(failingModel(500))).resolves.toEqual([]);
    });

    it("skips empty questions rather than asking a model about nothing", async () => {
      let called = false;
      const model = new MockLanguageModelV3({
        doGenerate: async () => {
          called = true;
          throw new Error("should never be reached");
        },
      });

      expect(await lint(model as LanguageModel, { questionPt: "  ", questionEn: "" })).toEqual([]);
      expect(called).toBe(false);
    });
  });
});
