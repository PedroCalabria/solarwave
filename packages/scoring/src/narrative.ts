import { generateStructured, type AiError, type LanguageModel } from "@solarwave/ai";
import { err, ok, type Result, type ScoreResult } from "@solarwave/core";
import type { ExtractedAnswer } from "./extract";
import { renderTranscript, type TranscriptTurn } from "./transcript";
import { z } from "zod";

export type CallLanguage = "pt" | "en";

export type Narrative = {
  reason: string;
  /** Null when the lead opted out: no outreach text is produced for them. */
  icebreaker: string | null;
};

export type NarrativeError = { kind: "model"; error: AiError };

const reasonSchema = z.object({
  reason: z.string().describe("Why the lead scored what they scored, in two or three sentences."),
});

const fullSchema = z.object({
  reason: z.string().describe("Why the lead scored what they scored, in two or three sentences."),
  icebreaker: z
    .string()
    .describe("One or two sentences a human consultant can open their call with, using what the lead said."),
});

/**
 * The content rules of spec section 6 apply to the written follow-up as much as
 * to the call, because a consultant reads the icebreaker aloud.
 */
const GUARDRAILS = [
  "Never state or estimate prices, quotes, savings amounts or percentages, even if the lead asked.",
  "Never promise an installation date, timeline or crew availability.",
  "Never make technical claims: no equipment brands, system sizes or warranty terms.",
  "Never give financial advice: no financing, instalments, payback or return figures.",
  "Never mention or compare against a competitor.",
  "Never use urgency or pressure language, and never invent a deadline.",
  "Never repeat sensitive personal data such as identity or banking numbers.",
].join("\n- ");

function systemPrompt(language: CallLanguage, withIcebreaker: boolean): string {
  const target = language === "pt" ? "Brazilian Portuguese" : "English";
  return [
    "You write the internal follow-up notes for a solar lead that an AI agent has just called.",
    "",
    `Write every field in ${target}. The icebreaker is read aloud by a human consultant calling this lead,`,
    "so it must sound natural spoken in that language.",
    "",
    "The reason must explain the score from the answers actually given: say which criteria passed, which",
    "failed, and which are still unknown. Never contradict the decision you are given. When a blocking",
    "criterion failed, name it explicitly as the reason the lead is disqualified.",
    withIcebreaker
      ? "The icebreaker must reference something specific the lead said, so the consultant sounds like they listened."
      : "",
    "",
    "Hard rules:",
    `- ${GUARDRAILS}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export type NarrativeInput = {
  model: LanguageModel;
  language: CallLanguage;
  leadName: string;
  /** Criterion labels by key, so the prose names criteria the way the portal does. */
  labels: Record<string, string>;
  score: ScoreResult;
  answers: ExtractedAnswer[];
  transcript: TranscriptTurn[];
  /**
   * False for an opted-out lead, or one with an unreviewed high-severity
   * opt-out violation. No outreach text is generated for them.
   */
  includeIcebreaker: boolean;
  maxRetries?: number;
};

function answersBlock(input: NarrativeInput): string {
  const label = (key: string) => input.labels[key] ?? key;
  const byKey = new Map(input.answers.map((a) => [a.criterionKey, a]));
  const line = (key: string, verdict: string) => {
    const answer = byKey.get(key);
    const value = answer?.value === null || answer?.value === undefined ? "no answer" : String(answer.value);
    return `- ${label(key)}: ${value} (${verdict})`;
  };

  return [
    ...input.score.passedKeys.map((k) => line(k, "passed")),
    ...input.score.failedKeys.map((k) => line(k, input.score.failedBlocking.includes(k) ? "FAILED, blocking" : "failed")),
    ...input.score.unansweredKeys.map((k) => line(k, "not answered")),
  ].join("\n");
}

export async function generateNarrative(input: NarrativeInput): Promise<Result<Narrative, NarrativeError>> {
  const result = await generateStructured({
    model: input.model,
    schema: input.includeIcebreaker ? fullSchema : reasonSchema,
    system: systemPrompt(input.language, input.includeIcebreaker),
    prompt: [
      `Lead: ${input.leadName}`,
      `Score: ${input.score.score} of 100. Decision: ${input.score.decision}.`,
      input.score.failedBlocking.length > 0
        ? `Failed blocking criteria: ${input.score.failedBlocking.map((k) => input.labels[k] ?? k).join(", ")}.`
        : "No blocking criterion failed.",
      "",
      "Answers:",
      answersBlock(input),
      "",
      "Transcript:",
      renderTranscript(input.transcript),
    ].join("\n"),
    maxRetries: input.maxRetries,
  });

  if (!result.ok) return err({ kind: "model", error: result.error });

  const value = result.value as { reason: string; icebreaker?: string };
  return ok({
    reason: value.reason,
    icebreaker: input.includeIcebreaker ? (value.icebreaker ?? null) : null,
  });
}
