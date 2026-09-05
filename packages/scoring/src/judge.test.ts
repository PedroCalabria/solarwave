import { fakeStructuredModel, failingModel } from "@solarwave/ai";
import { describe, expect, it } from "vitest";
import { GUARDRAIL_KEYS, SEVERITY, blocksOutreach } from "./guardrails";
import { judgeTranscript } from "./judge";
import type { TranscriptTurn } from "./transcript";

/** One transcript per judged guardrail, each containing the offending line. */
const CASES: Record<string, { turn: TranscriptTurn; quote: string }> = {
  no_prices_or_savings: {
    turn: { who: "ai", text: "Você economiza uns quarenta por cento na conta." },
    quote: "economiza uns quarenta por cento",
  },
  no_timeline_promises: {
    turn: { who: "ai", text: "A equipe instala em duas semanas." },
    quote: "instala em duas semanas",
  },
  no_technical_claims: {
    turn: { who: "ai", text: "São painéis Canadian de 550 watts com garantia de 25 anos." },
    quote: "garantia de 25 anos",
  },
  no_financial_advice: {
    turn: { who: "ai", text: "Financiando em 60 vezes o retorno vem em quatro anos." },
    quote: "o retorno vem em quatro anos",
  },
  no_competitor_comparison: {
    turn: { who: "ai", text: "Nossos painéis são melhores que os da concorrente." },
    quote: "melhores que os da concorrente",
  },
  no_artificial_urgency: {
    turn: { who: "ai", text: "Essa condição termina hoje, precisa decidir agora." },
    quote: "termina hoje",
  },
  no_sensitive_data: {
    turn: { who: "ai", text: "Pode me passar o número completo do seu CPF e a conta bancária?" },
    quote: "número completo do seu CPF",
  },
  opt_out_missed: {
    turn: { who: "lead", text: "Não me liguem mais, por favor." },
    quote: "Não me liguem mais",
  },
};

const cleanTranscript: TranscriptTurn[] = [
  { who: "ai", text: "Sou o assistente virtual da Soltera. Posso fazer quatro perguntas rápidas?" },
  { who: "lead", text: "Pode falar." },
  { who: "ai", text: "O imóvel é seu ou alugado?" },
  { who: "lead", text: "É meu." },
];

describe("judgeTranscript", () => {
  for (const key of GUARDRAIL_KEYS) {
    it(`flags ${key} with the fixed severity and a quoted line`, async () => {
      const { turn, quote } = CASES[key]!;
      const transcript = [...cleanTranscript, turn];

      const result = await judgeTranscript({
        model: fakeStructuredModel({ findings: [{ guardrail: key, evidence: quote }] }),
        transcript,
        optOutAlreadyRecorded: false,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]).toEqual({ guardrail: key, severity: SEVERITY[key], evidence: quote });
    });
  }

  it("writes nothing for a clean transcript", async () => {
    const result = await judgeTranscript({
      model: fakeStructuredModel({ findings: [] }),
      transcript: cleanTranscript,
      optOutAlreadyRecorded: false,
    });
    expect(result.ok && result.value).toEqual([]);
  });

  it("ranks the same violation identically across runs", async () => {
    const run = () =>
      judgeTranscript({
        model: fakeStructuredModel({
          findings: [{ guardrail: "no_prices_or_savings", evidence: "economiza uns quarenta por cento" }],
        }),
        transcript: [...cleanTranscript, CASES.no_prices_or_savings!.turn],
        optOutAlreadyRecorded: false,
      });

    const [a, b] = await Promise.all([run(), run()]);
    expect(a.ok && b.ok && a.value[0]?.severity).toBe(b.ok ? b.value[0]?.severity : null);
  });

  it("discards a guardrail key that is not in the table", async () => {
    const result = await judgeTranscript({
      model: fakeStructuredModel({ findings: [{ guardrail: "no_bad_vibes", evidence: "É meu." }] }),
      transcript: cleanTranscript,
      optOutAlreadyRecorded: false,
    });
    expect(result.ok && result.value).toEqual([]);
  });

  it("does not raise opt_out_missed when the call already ended as an opt-out", async () => {
    const result = await judgeTranscript({
      model: fakeStructuredModel({ findings: [{ guardrail: "opt_out_missed", evidence: "Não me liguem mais" }] }),
      transcript: [...cleanTranscript, CASES.opt_out_missed!.turn],
      optOutAlreadyRecorded: true,
    });
    expect(result.ok && result.value).toEqual([]);
  });

  it("drops a quote the model did not take from the transcript", async () => {
    const result = await judgeTranscript({
      model: fakeStructuredModel({
        findings: [{ guardrail: "no_prices_or_savings", evidence: "The agent quoted a price." }],
      }),
      transcript: [...cleanTranscript, CASES.no_prices_or_savings!.turn],
      optOutAlreadyRecorded: false,
    });
    expect(result.ok && result.value[0]?.evidence).toBeNull();
  });

  it("reports one row per guardrail even if the model repeats itself", async () => {
    const result = await judgeTranscript({
      model: fakeStructuredModel({
        findings: [
          { guardrail: "no_prices_or_savings", evidence: "economiza uns quarenta por cento" },
          { guardrail: "no_prices_or_savings", evidence: "economiza uns quarenta por cento" },
        ],
      }),
      transcript: [...cleanTranscript, CASES.no_prices_or_savings!.turn],
      optOutAlreadyRecorded: false,
    });
    expect(result.ok && result.value).toHaveLength(1);
  });

  it("surfaces a model failure without pretending the call was clean", async () => {
    const result = await judgeTranscript({
      model: failingModel(503),
      transcript: cleanTranscript,
      optOutAlreadyRecorded: false,
      maxRetries: 0,
    });
    expect(result.ok).toBe(false);
  });
});

describe("severity table", () => {
  it("blocks outreach only where calling again could compound harm", () => {
    expect(blocksOutreach("opt_out_missed")).toBe(true);
    expect(blocksOutreach("no_sensitive_data")).toBe(true);
    expect(blocksOutreach("no_prices_or_savings")).toBe(false);
    expect(blocksOutreach("no_competitor_comparison")).toBe(false);
  });

  it("assigns a severity to every guardrail it can report", () => {
    for (const key of GUARDRAIL_KEYS) expect(SEVERITY[key]).toBeDefined();
  });
});
