import {
  err,
  ok,
  parseExpectedValue,
  parseOptionList,
  validateVocabulary,
  type CriterionType,
  type Result,
  type RuleError,
} from "@solarwave/core";
import { z } from "zod";

/** The criterion fields extraction needs. Deliberately not the database row. */
export type ExtractionCriterion = {
  key: string;
  label: string;
  type: CriterionType;
  /** Enum vocabulary. Everything a lead can be recorded as answering. */
  options: string | null;
  /** The subset of the vocabulary that passes. Never constrains the schema. */
  expectedValue: string | null;
  active: boolean;
};

export type ExtractionSchema = {
  schema: z.ZodType;
  /** Active criterion keys, in schema order. */
  keys: string[];
  /** Whether the reserved callback field was actually added. */
  hasCallback: boolean;
};

/**
 * Deliberately unbounded at the schema level. Confidence is informational and
 * never touches the score (design D7), so a model writing 1.2 must not fail an
 * otherwise good extraction. The extractor clamps it to 0..1 instead.
 */
const confidence = z.number().describe("How certain the answer is, 0 to 1. Never guess to raise it.");

const evidence = z
  .string()
  .describe("A verbatim quote from the transcript supporting the answer. Empty when the value is null.");

function valueSchema(criterion: ExtractionCriterion): z.ZodType {
  switch (criterion.type) {
    case "boolean":
      return z.boolean().nullable();
    case "numeric":
      return z.number().nullable();
    case "free_text":
      return z.string().nullable();
    case "enum": {
      const vocabulary = parseOptionList(criterion.options);
      return z.enum(vocabulary as [string, ...string[]]).nullable();
    }
  }
}

/**
 * Builds the structured-output schema from the active criteria (design D5).
 *
 * Enum criteria are constrained to their `options` vocabulary, never to
 * `expected_value`. `expected_value` is the subset that passes, so constraining
 * to it would make a failing answer unrepresentable and no enum criterion could
 * ever fail. The vocabulary is what the model may say; the engine decides what
 * passes, afterwards and deterministically.
 *
 * Returns validation errors instead of a schema when any active criterion is
 * misconfigured, so a bad rule fails before a model is ever called.
 */
export function buildExtractionSchema(
  criteria: ExtractionCriterion[],
  withCallback = false,
): Result<ExtractionSchema, RuleError[]> {
  const active = criteria.filter((c) => c.active);
  const errors: RuleError[] = [];

  for (const criterion of active) {
    const rule = parseExpectedValue(criterion.type, criterion.expectedValue);
    if (!rule.ok) errors.push({ criterionKey: criterion.key, message: rule.error.message });

    for (const problem of validateVocabulary(criterion)) {
      errors.push({ criterionKey: criterion.key, message: `${problem.field}: ${problem.message}` });
    }
  }

  if (errors.length > 0) return err(errors);

  const shape: Record<string, z.ZodType> = {};
  for (const criterion of active) {
    shape[criterion.key] = z
      .object({
        value: valueSchema(criterion),
        confidence,
        evidence,
      })
      .describe(criterion.label);
  }

  // Guarded rather than assumed: if a criterion has taken the reserved key, the
  // criterion wins and the callback is simply not asked for. A real criterion
  // going missing would be the worse failure.
  const includeCallback = !active.some((c) => c.key === CALLBACK_KEY);
  if (withCallback && includeCallback) shape[CALLBACK_KEY] = callbackField;

  return ok({ schema: z.object(shape), keys: active.map((c) => c.key), hasCallback: withCallback && includeCallback });
}

/**
 * The reserved schema key the requested callback is read under
 * (lifecycle-and-operations D6).
 *
 * Underscore-prefixed because criterion keys are slugs derived from labels and
 * never start with one, so it cannot collide with a real criterion. The
 * collision is guarded anyway: `buildExtractionSchema` refuses to add the field
 * when a criterion has somehow taken the key, and extraction simply reports no
 * callback rather than failing an otherwise good pass.
 */
export const CALLBACK_KEY = "_requested_callback";

/**
 * The model is asked for a LOCAL WALL CLOCK, not an instant.
 *
 * Asking a language model for a timezone-correct ISO instant invites it to do
 * offset arithmetic, which is exactly the arithmetic `localToInstant` already
 * does correctly and deterministically, DST included. So the model resolves
 * "tomorrow morning" to `2026-09-07T09:00` in the lead's own timezone and the
 * conversion stays in code.
 */
export const callbackField = z
  .unknown()
  .optional()
  .describe(
    "A time the lead asked to be called back at, as an object " +
      '{ "said": string, "local_datetime": string | null }. `said` is their own words, verbatim, empty when ' +
      "they did not ask. `local_datetime` is YYYY-MM-DDTHH:mm in the lead's LOCAL timezone, or null when they " +
      "did not ask or were too vague to place on a clock.",
  );

/**
 * Deliberately unstructured at the schema level, for the same reason
 * `confidence` is unbounded: this field must not be able to fail an otherwise
 * good extraction.
 *
 * MEASURED while building it — declared as a required object, a model that
 * simply omitted the key failed structured-output validation and took every
 * criteria answer down with it. Change 3 measured this model omitting fields it
 * was asked for and change 4 measured it omitting required tool arguments, so
 * that is the normal case, not the exotic one. The shape lives in the
 * description and in the prompt; `readCallback` is what enforces it, and it
 * degrades to "no callback" on anything it does not recognise.
 */

/** The vocabulary the model may answer an enum criterion with, for prompt text. */
export function vocabularyFor(criterion: ExtractionCriterion): string[] {
  return criterion.type === "enum" ? parseOptionList(criterion.options) : [];
}
