import { generateStructured, hasApiKey, type LanguageModel } from "@solarwave/ai";
import { z } from "zod";
import { GUARDRAIL_RULES } from "./frame";

/** Which question a warning is about, so the form can point at the right field. */
export const LINT_FIELDS = ["questionPt", "questionEn", "both"] as const;
export type LintField = (typeof LINT_FIELDS)[number];

export const LINT_CONCERNS = ["tone", "justification", "guardrail"] as const;
export type LintConcern = (typeof LINT_CONCERNS)[number];

export type LintWarning = {
  field: LintField;
  concern: LintConcern;
  /** One sentence an admin can act on. Advice, never an error. */
  message: string;
};

export type LintInput = {
  model: LanguageModel;
  label: string;
  questionPt: string;
  questionEn: string;
  /** Skipped entirely when no key is configured, so the portal works without one. */
  env?: NodeJS.ProcessEnv;
  maxRetries?: number;
};

const warningSchema = z.object({
  warnings: z
    .array(
      z.object({
        field: z.enum(LINT_FIELDS),
        concern: z.enum(LINT_CONCERNS),
        message: z.string(),
      }),
    )
    .describe("Every concern found. Empty when the questions are fine."),
});

const SYSTEM = [
  "You review the questions an AI agent will ask a solar lead over the phone, and you warn about",
  "problems. You are advising a colleague who wrote them, not gatekeeping their work.",
  "",
  "Warn about exactly three kinds of problem:",
  "",
  '- "tone": the question insults, judges, patronises or embarrasses the lead, or implies something',
  "  negative about their situation. A question about money is fine; a question that implies the lead",
  "  cannot afford something is not.",
  '- "justification": the question asks the lead to explain, justify or defend an answer, especially a',
  "  negative one. The agent gathers answers; it never asks anyone to account for them.",
  '- "guardrail": answering or asking the question would require the agent to break one of the hard',
  "  rules below.",
  "",
  "The agent's hard rules:",
  ...GUARDRAIL_RULES.map((rule) => `- ${rule}`),
  "",
  "Report nothing for a neutral, factual question. Do not invent style preferences, do not comment on",
  "grammar or length, and do not warn about a question merely because it touches money, roofs or",
  "timing — those are the job. One warning per distinct problem, each one sentence.",
].join("\n");

/**
 * The advisory pass over a criterion's questions (design D10).
 *
 * Every failure path returns no warnings: no API key, a rate-limited request,
 * unparseable output, a timeout. The linter has no authority over whether an
 * admin's work is accepted — it is advice from a model about tone, and a
 * portal that refuses to save a criterion because a model was busy would be a
 * worse portal than one with no linter at all.
 */
export async function lintQuestions({
  model,
  label,
  questionPt,
  questionEn,
  env = process.env,
  maxRetries = 1,
}: LintInput): Promise<LintWarning[]> {
  if (!hasApiKey(env)) return [];
  if (questionPt.trim().length === 0 && questionEn.trim().length === 0) return [];

  try {
    const result = await generateStructured({
      model,
      schema: warningSchema,
      system: SYSTEM,
      prompt: [
        `Criterion: ${label}`,
        `Portuguese question: ${questionPt}`,
        `English question: ${questionEn}`,
      ].join("\n"),
      maxRetries,
    });

    // A model error is not an admin's problem. `generateStructured` already
    // returns rather than throws, so this is the rate-limit and bad-output path.
    if (!result.ok) return [];
    return result.value.warnings;
  } catch {
    // Belt and braces: nothing this function does may reach the caller as a throw.
    return [];
  }
}
