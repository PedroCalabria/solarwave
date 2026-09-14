import { CRITERIA, LEADS } from "@solarwave/db/seed";
import type { ExtractionCriterion } from "./extractionSchema";
import type { TranscriptTurn } from "./transcript";

/**
 * The golden set: the hand-written transcripts and expected answers that ship
 * with the seed. They exist because extraction quality has to be measurable
 * before a single Twilio minute is spent, and they are shared by the mocked
 * unit tests and the real-model eval so the two cannot drift.
 */
export type GoldenCase = {
  leadName: string;
  language: "pt" | "en";
  attemptNumber: number;
  transcript: TranscriptTurn[];
  /** Expected normalised value per criterion key. Absent keys must extract null. */
  expected: Record<string, boolean | number | string>;
};

export const GOLDEN_CRITERIA: ExtractionCriterion[] = CRITERIA.map((c) => ({
  key: c.key,
  label: c.label,
  type: c.type,
  options: c.options,
  expectedValue: c.expectedValue,
  active: c.active,
}));

export const GOLDEN_CASES: GoldenCase[] = LEADS.flatMap((lead) =>
  lead.attempts
    .filter((attempt) => attempt.transcript && attempt.transcript.length > 0 && attempt.answers)
    .map((attempt) => ({
      leadName: lead.name,
      language: lead.callLanguage,
      attemptNumber: attempt.n,
      transcript: attempt.transcript as TranscriptTurn[],
      expected: Object.fromEntries(
        Object.entries(attempt.answers ?? {}).map(([key, answer]) => [key, answer.value]),
      ),
    })),
);

/** Transcripts with no expected answers still exercise the guardrail judge. */
export const GOLDEN_TRANSCRIPTS: { leadName: string; transcript: TranscriptTurn[] }[] = LEADS.flatMap((lead) =>
  lead.attempts
    .filter((attempt) => attempt.transcript && attempt.transcript.length > 0)
    .map((attempt) => ({ leadName: lead.name, transcript: attempt.transcript as TranscriptTurn[] })),
);

export type CriterionScore = { key: string; correct: number; total: number; misses: string[] };

/**
 * Compares an extraction against the golden answers.
 *
 * A criterion the golden case does not mention is expected to extract null:
 * inventing an answer is as wrong as getting one wrong, so it counts against
 * the score rather than being skipped.
 */
export function gradeExtraction(
  expected: GoldenCase["expected"],
  actual: { criterionKey: string; value: unknown }[],
  criteriaKeys: string[],
): CriterionScore[] {
  const byKey = new Map(actual.map((a) => [a.criterionKey, a.value]));

  return criteriaKeys.map((key) => {
    const want = key in expected ? expected[key] : null;
    const got = byKey.get(key) ?? null;
    const correct = normalise(want) === normalise(got);
    return {
      key,
      correct: correct ? 1 : 0,
      total: 1,
      misses: correct ? [] : [`expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`],
    };
  });
}

function normalise(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value.trim().toLowerCase();
  return String(value);
}

/**
 * Golden cases for the requested callback (lifecycle-and-operations D6).
 *
 * Kept separate from `GOLDEN_CASES` on purpose: those carry hand-verified
 * expected answers for the SCORING criteria, and folding a new expectation into
 * them would change what they assert. These exercise one field, and like the
 * rest of the golden set they are shared by the mocked test and the real-model
 * eval so the two cannot drift.
 *
 * `expectedLocal` is a local wall clock in `timezone`, which is what the model
 * is asked for; null means the phrase is deliberately unresolvable and the
 * interval policy must stand.
 */
export type CallbackCase = {
  name: string;
  timezone: string;
  /** When the call ended, as a local wall clock, so "tomorrow" has a meaning. */
  endedAtLocal: string;
  transcript: TranscriptTurn[];
  expectedLocal: string | null;
  /** A phrase the verbatim `said` field should contain. */
  saidContains: string;
};

export const CALLBACK_CASES: CallbackCase[] = [
  {
    name: "asks for tomorrow morning",
    timezone: "America/Sao_Paulo",
    endedAtLocal: "2026-09-06T14:30",
    transcript: [
      { who: "ai", text: "Posso te fazer duas perguntas rápidas sobre a sua conta de luz?" },
      { who: "lead", text: "Agora não dá, estou dirigindo. Me liga amanhã de manhã, umas nove horas." },
      { who: "ai", text: "Combinado, eu retorno. Obrigada pelo seu tempo." },
    ],
    expectedLocal: "2026-09-07T09:00",
    saidContains: "amanhã",
  },
  {
    name: "too vague to place on a clock",
    timezone: "America/Sao_Paulo",
    endedAtLocal: "2026-09-06T14:30",
    transcript: [
      { who: "ai", text: "Posso te fazer duas perguntas rápidas sobre a sua conta de luz?" },
      { who: "lead", text: "Ah, me liga qualquer hora dessas, quando der." },
      { who: "ai", text: "Sem problema, eu retorno. Obrigada." },
    ],
    // The lead did ask to be called back, and gave nothing a clock can hold.
    // Guessing here is the failure; the 15-minute / 2-day policy must stand.
    expectedLocal: null,
    saidContains: "qualquer hora",
  },
  {
    name: "no callback asked for at all",
    timezone: "America/Sao_Paulo",
    endedAtLocal: "2026-09-06T14:30",
    transcript: [
      { who: "ai", text: "O imóvel é seu ou alugado?" },
      { who: "lead", text: "É meu, moro aqui há nove anos." },
      { who: "ai", text: "Obrigada. Um especialista entra em contato." },
    ],
    expectedLocal: null,
    saidContains: "",
  },
];
