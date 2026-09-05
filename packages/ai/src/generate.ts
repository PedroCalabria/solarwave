import { err, ok, type Result } from "@solarwave/core";
import { APICallError, generateText, Output, type LanguageModel } from "ai";
import type { z } from "zod";

export type AiError =
  /** Not retryable: the request itself is wrong, or the account cannot pay. */
  | { kind: "budget"; message: string }
  /** Not retryable: the gateway account is not set up to service requests. */
  | { kind: "account"; message: string }
  | { kind: "invalid_model"; message: string }
  | { kind: "invalid_output"; message: string }
  /** Retryable, but only after the SDK already exhausted `maxRetries`. */
  | { kind: "rate_limited"; message: string; retryAfter?: string }
  | { kind: "unavailable"; message: string }
  | { kind: "call_failed"; message: string; statusCode?: number };

export type GenerateStructuredInput<T extends z.ZodType> = {
  /**
   * A gateway slug (`"google/gemini-3.8-flash"`) in production, or a
   * `MockLanguageModelV3` in tests. Tests never touch the network.
   */
  model: LanguageModel;
  schema: T;
  system: string;
  prompt: string;
  /**
   * The SDK retries transient failures itself with exponential backoff, so we
   * configure it rather than wrapping another loop around it. Default 2.
   */
  maxRetries?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
};

/**
 * The single model entry point for every non-realtime call in SolarWave.
 *
 * The AI SDK v6 has no `generateObject`: structured output is `generateText`
 * with `Output.object`, which returns the parsed value on `output`.
 */
export async function generateStructured<T extends z.ZodType>({
  model,
  schema,
  system,
  prompt,
  maxRetries = 2,
  temperature = 0,
  abortSignal,
}: GenerateStructuredInput<T>): Promise<Result<z.infer<T>, AiError>> {
  try {
    const { output } = await generateText({
      model,
      output: Output.object({ schema }),
      system,
      prompt,
      maxRetries,
      temperature,
      abortSignal,
    });
    if (output === undefined || output === null) {
      return err({ kind: "invalid_output", message: "the model returned no structured output" });
    }
    return ok(output as z.infer<T>);
  } catch (cause) {
    return err(toAiError(cause));
  }
}

/**
 * An account that cannot service requests at all: no card on file, provider not
 * enabled. Retrying is pure waste, so it is not classified as transient.
 */
const ACCOUNT_BLOCKED = /credit card|payment method|not enabled|no active plan/i;

/**
 * Checked FIRST, because a quota message can mention billing while still being
 * entirely transient. Google's free-tier limit says "check your plan and
 * billing details" in the same breath as "Please retry in 3.1s"; treating that
 * as an account problem would stop a worker that only needed to wait.
 */
const QUOTA = /quota|rate.?limit|exceeded your current quota|too many requests|high demand/i;

export function toAiError(cause: unknown): AiError {
  if (APICallError.isInstance(cause)) {
    const status = cause.statusCode;
    if (QUOTA.test(cause.message)) return { kind: "rate_limited", message: cause.message };
    if (ACCOUNT_BLOCKED.test(cause.message)) return { kind: "account", message: cause.message };
    if (status === 402) return { kind: "budget", message: "AI Gateway budget exhausted" };
    if (status === 429) {
      const header = cause.responseHeaders?.["retry-after"];
      return { kind: "rate_limited", message: cause.message, retryAfter: header };
    }
    if (status === 400 && /model/i.test(cause.message)) {
      return { kind: "invalid_model", message: cause.message };
    }
    if (status === 503 || status === 502) return { kind: "unavailable", message: cause.message };
    return { kind: "call_failed", message: cause.message, statusCode: status };
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  if (QUOTA.test(message)) return { kind: "rate_limited", message };
  if (ACCOUNT_BLOCKED.test(message)) return { kind: "account", message };
  return { kind: "call_failed", message };
}

/** Whether retrying later could plausibly succeed. Drives the worker's failure handling. */
export function isRetryable(error: AiError): boolean {
  return error.kind === "rate_limited" || error.kind === "unavailable" || error.kind === "call_failed";
}

/** Whether a human has to change something before any call can succeed. */
export function needsOperatorAction(error: AiError): boolean {
  return error.kind === "account" || error.kind === "budget" || error.kind === "invalid_model";
}
