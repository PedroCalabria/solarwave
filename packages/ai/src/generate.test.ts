import { describe, expect, it } from "vitest";
import { z } from "zod";
import { generateStructured, isRetryable, needsOperatorAction, toAiError } from "./generate";
import { fakeStructuredModel, failingModel } from "./testing";

const schema = z.object({ answer: z.string(), score: z.number() });

describe("generateStructured", () => {
  it("returns the parsed structured output", async () => {
    const result = await generateStructured({
      model: fakeStructuredModel({ answer: "yes", score: 42 }),
      schema,
      system: "s",
      prompt: "p",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ answer: "yes", score: 42 });
  });

  it("reports output that does not match the schema", async () => {
    const result = await generateStructured({
      model: fakeStructuredModel({ answer: "yes", score: "not a number" }),
      schema,
      system: "s",
      prompt: "p",
      maxRetries: 0,
    });

    expect(result.ok).toBe(false);
  });

  it("maps 429 to a retryable rate_limited error carrying retry-after", async () => {
    const result = await generateStructured({
      model: failingModel(429),
      schema,
      system: "s",
      prompt: "p",
      maxRetries: 0,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("rate_limited");
      if (result.error.kind === "rate_limited") expect(result.error.retryAfter).toBe("30");
      expect(isRetryable(result.error)).toBe(true);
    }
  });

  it("maps 402 to a non-retryable budget error", async () => {
    const result = await generateStructured({
      model: failingModel(402),
      schema,
      system: "s",
      prompt: "p",
      maxRetries: 0,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("budget");
      expect(isRetryable(result.error)).toBe(false);
    }
  });

  it("classifies unknown throwables as call_failed", () => {
    expect(toAiError(new Error("network down"))).toEqual({ kind: "call_failed", message: "network down" });
  });
});

describe("account problems are not transient", () => {
  it("classifies a gateway that refuses to service requests as an account problem", () => {
    const error = toAiError(
      new Error("AI Gateway requires a valid credit card on file to service requests."),
    );
    expect(error.kind).toBe("account");
    // Retrying this burns time and changes nothing: a human must act.
    expect(isRetryable(error)).toBe(false);
    expect(needsOperatorAction(error)).toBe(true);
  });

  it("still treats a genuine network blip as retryable", () => {
    const error = toAiError(new Error("socket hang up"));
    expect(error.kind).toBe("call_failed");
    expect(isRetryable(error)).toBe(true);
    expect(needsOperatorAction(error)).toBe(false);
  });
});

describe("quota is transient even when the message mentions billing", () => {
  it("classifies Google's free-tier quota error as retryable", () => {
    // Verified against the real API: the message names billing and a retry
    // delay in the same breath. Treating it as an account problem would stop a
    // worker that only needed to wait three seconds.
    const error = toAiError(
      new Error(
        "You exceeded your current quota, please check your plan and billing details. " +
          "Quota exceeded for metric: generate_content_free_tier_requests, limit: 5. Please retry in 3.1s.",
      ),
    );
    expect(error.kind).toBe("rate_limited");
    expect(isRetryable(error)).toBe(true);
    expect(needsOperatorAction(error)).toBe(false);
  });

  it("classifies a model overload as retryable", () => {
    const error = toAiError(new Error("This model is currently experiencing high demand."));
    expect(error.kind).toBe("rate_limited");
    expect(isRetryable(error)).toBe(true);
  });

  it("still catches a genuine account block", () => {
    const error = toAiError(new Error("requires a valid credit card on file to service requests"));
    expect(error.kind).toBe("account");
    expect(needsOperatorAction(error)).toBe(true);
  });
});
