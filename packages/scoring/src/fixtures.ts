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
