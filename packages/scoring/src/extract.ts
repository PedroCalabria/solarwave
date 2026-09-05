import { generateStructured, type AiError, type LanguageModel } from "@solarwave/ai";
import { err, ok, type Result, type RuleError } from "@solarwave/core";
import { buildExtractionSchema, vocabularyFor, type ExtractionCriterion } from "./extractionSchema";
import { renderTranscript, verifiedEvidence, type TranscriptTurn } from "./transcript";

export type ExtractedAnswer = {
  criterionKey: string;
  /** Typed value the engine evaluates. Null means the criterion went unanswered. */
  value: boolean | number | string | null;
  confidence: number;
  /** A verbatim transcript quote, or null when the model could not produce one. */
  evidence: string | null;
};

export type ExtractionError =
  | { kind: "invalid_criteria"; errors: RuleError[] }
  | { kind: "no_transcript" }
  | { kind: "model"; error: AiError };

const SYSTEM = [
  "You extract structured qualification answers from a transcript of a solar sales call.",
  "",
  "Rules:",
  "- Report only what the lead actually said. Never infer, never assume, never fill a gap.",
  "- When a criterion was not discussed, or the answer is genuinely unclear, set value to null.",
  "- evidence must be an exact quote copied from a transcript line, not a summary. Use the lead's",
  "  own words and language. When there is nothing to quote, use an empty string.",
  "- confidence reflects how clearly the lead answered, not how much you want to answer.",
  "- For a criterion with a list of options, you must return exactly one of those options.",
  "  Choose the option that matches what the lead said. Some options do not qualify the lead;",
  "  that is expected and is not a reason to avoid them or to return null.",
  "- Do not judge, score or qualify. Another system does that from your answers.",
].join("\n");

function criteriaBlock(criteria: ExtractionCriterion[]): string {
  return criteria
    .filter((c) => c.active)
    .map((c) => {
      const vocabulary = vocabularyFor(c);
      const shape =
        c.type === "enum"
          ? `one of: ${vocabulary.join(", ")}`
          : c.type === "numeric"
            ? "a number"
            : c.type === "boolean"
              ? "true or false"
              : "a short free-text answer";
      return `- ${c.key} (${c.label}): ${shape}`;
    })
    .join("\n");
}

export type ExtractInput = {
  criteria: ExtractionCriterion[];
  transcript: TranscriptTurn[];
  model: LanguageModel;
  maxRetries?: number;
};

/**
 * Turns a transcript into typed, evidence-backed answers.
 *
 * Criteria are validated first, so a malformed rule or a missing enum
 * vocabulary fails before a model is ever called (and therefore before any
 * token is spent).
 */
export async function extractAnswers({
  criteria,
  transcript,
  model,
  maxRetries,
}: ExtractInput): Promise<Result<ExtractedAnswer[], ExtractionError>> {
  const built = buildExtractionSchema(criteria);
  if (!built.ok) return err({ kind: "invalid_criteria", errors: built.error });
  if (transcript.length === 0) return err({ kind: "no_transcript" });

  const generated = await generateStructured({
    model,
    schema: built.value.schema,
    system: SYSTEM,
    prompt: [
      "Criteria to extract:",
      criteriaBlock(criteria),
      "",
      "Transcript:",
      renderTranscript(transcript),
    ].join("\n"),
    maxRetries,
  });
  if (!generated.ok) return err({ kind: "model", error: generated.error });

  const raw = generated.value as Record<string, { value: unknown; confidence: number; evidence: string }>;

  return ok(
    built.value.keys.map((key) => {
      const answer = raw[key];
      return {
        criterionKey: key,
        value: (answer?.value ?? null) as ExtractedAnswer["value"],
        confidence: clampConfidence(answer?.confidence),
        evidence: verifiedEvidence(answer?.evidence, transcript),
      };
    }),
  );
}

function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
