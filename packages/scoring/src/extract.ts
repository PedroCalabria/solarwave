import { generateStructured, type AiError, type LanguageModel } from "@solarwave/ai";
import { err, localToInstant, ok, toLocalParts, type Result, type RuleError } from "@solarwave/core";
import { CALLBACK_KEY, buildExtractionSchema, vocabularyFor, type ExtractionCriterion } from "./extractionSchema";
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

/**
 * What the lead asked for, and what it resolved to
 * (lifecycle-and-operations D6).
 *
 * Both halves are kept: `said` is stored and shown even when `at` is null, so a
 * person can always see the request and what the machine did with it.
 */
export type RequestedCallback = {
  /** The lead's own words, verbatim. */
  said: string;
  /** The resolved instant, or null when nothing usable could be placed on a clock. */
  at: Date | null;
};

/**
 * The context a callback time can only be resolved against: when the call
 * happened, and in which timezone "tomorrow morning" means anything.
 */
export type CallbackContext = { timezone: string; endedAt: Date };

export type ExtractionOutput = {
  answers: ExtractedAnswer[];
  /** Null when no context was supplied, or the lead asked for nothing. */
  callback: RequestedCallback | null;
};

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
  /**
   * Supply this to also read a requested callback in the SAME model call. Left
   * out, the pass behaves exactly as it did before this field existed — which
   * is what the eval harness and the schema tests rely on.
   */
  callback?: CallbackContext;
};

/**
 * Turns a transcript into typed, evidence-backed answers.
 *
 * Criteria are validated first, so a malformed rule or a missing enum
 * vocabulary fails before a model is ever called (and therefore before any
 * token is spent).
 */
export async function extractAnswers(input: ExtractInput): Promise<Result<ExtractedAnswer[], ExtractionError>> {
  const result = await extractCall(input);
  return result.ok ? ok(result.value.answers) : result;
}

/**
 * The full pass: criteria answers and, when a context is supplied, the callback
 * the lead asked for — from ONE model call.
 *
 * One call rather than two because the second would be a second failure mode
 * for information the first is already reading, and because a transcript is not
 * cheap to send twice.
 */
export async function extractCall({
  criteria,
  transcript,
  model,
  maxRetries,
  callback,
}: ExtractInput): Promise<Result<ExtractionOutput, ExtractionError>> {
  const built = buildExtractionSchema(criteria, callback !== undefined);
  if (!built.ok) return err({ kind: "invalid_criteria", errors: built.error });
  if (transcript.length === 0) return err({ kind: "no_transcript" });

  const generated = await generateStructured({
    model,
    schema: built.value.schema,
    system: SYSTEM,
    prompt: [
      "Criteria to extract:",
      criteriaBlock(criteria),
      ...(built.value.hasCallback && callback ? ["", callbackBlock(callback)] : []),
      "",
      "Transcript:",
      renderTranscript(transcript),
    ].join("\n"),
    maxRetries,
  });
  if (!generated.ok) return err({ kind: "model", error: generated.error });

  const raw = generated.value as Record<string, { value: unknown; confidence: number; evidence: string }>;

  const answers = built.value.keys.map((key) => {
    const answer = raw[key];
    return {
      criterionKey: key,
      value: (answer?.value ?? null) as ExtractedAnswer["value"],
      confidence: clampConfidence(answer?.confidence),
      evidence: verifiedEvidence(answer?.evidence, transcript),
    };
  });

  return ok({
    answers,
    callback:
      built.value.hasCallback && callback
        ? readCallback((generated.value as Record<string, unknown>)[CALLBACK_KEY], callback)
        : null,
  });
}

/** Tells the model when "tomorrow" is, in the only timezone that means anything here. */
function callbackBlock({ timezone, endedAt }: CallbackContext): string {
  const p = toLocalParts(endedAt, timezone);
  const stamp =
    `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}` +
    `T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  return [
    `The call happened at ${stamp} local time for this lead (timezone ${timezone}).`,
    `Also return ${CALLBACK_KEY} as an object with exactly two fields:`,
    '  "said": the lead\'s own words asking to be called at another time, verbatim; "" if they did not ask.',
    '  "local_datetime": YYYY-MM-DDTHH:mm in the lead\'s LOCAL time, resolved against the time above and',
    "                    never UTC; null if they did not ask, or were too vague to place on a clock.",
    "A vague answer is not a failure; guessing one is.",
  ].join("\n");
}

/**
 * Reads the callback field defensively.
 *
 * Change 3 measured this model omitting fields it was asked to provide, and
 * change 4 measured it omitting required tool arguments. So every branch here
 * degrades to "no callback" rather than throwing: an unusable time must cost
 * the criteria answers nothing.
 */
function readCallback(raw: unknown, context: CallbackContext): RequestedCallback | null {
  if (!raw || typeof raw !== "object") return null;
  const field = raw as { said?: unknown; local_datetime?: unknown };

  const said = typeof field.said === "string" ? field.said.trim() : "";
  const local = typeof field.local_datetime === "string" ? field.local_datetime.trim() : "";
  if (!said && !local) return null;

  return { said, at: local ? parseLocalDateTime(local, context.timezone) : null };
}

/** `YYYY-MM-DDTHH:mm` in the lead's timezone. Anything else is no callback at all. */
function parseLocalDateTime(value: string, timezone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value);
  if (!match) return null;

  const [, year, month, day, hour, minute] = match.map(Number) as [number, number, number, number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;

  const at = localToInstant({ year, month, day, hour, minute }, timezone);
  return Number.isNaN(at.getTime()) ? null : at;
}

function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
