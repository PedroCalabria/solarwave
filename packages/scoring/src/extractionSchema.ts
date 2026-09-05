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
export function buildExtractionSchema(criteria: ExtractionCriterion[]): Result<ExtractionSchema, RuleError[]> {
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

  return ok({ schema: z.object(shape), keys: active.map((c) => c.key) });
}

/** The vocabulary the model may answer an enum criterion with, for prompt text. */
export function vocabularyFor(criterion: ExtractionCriterion): string[] {
  return criterion.type === "enum" ? parseOptionList(criterion.options) : [];
}
