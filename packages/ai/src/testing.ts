import { APICallError, type LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";

export type FakeCall = { system: string | undefined; prompt: unknown };

/**
 * A language model that always answers with `value`, serialised as the JSON the
 * structured-output path parses. Every test in the monorepo goes through this
 * instead of the network, so CI is free and deterministic (design D14).
 *
 * `calls` records what was sent, which is how prompt-assembly tests assert on
 * the criteria that reached the model.
 */
export function fakeStructuredModel(value: unknown, calls: FakeCall[] = []): LanguageModel {
  return new MockLanguageModelV3({
    doGenerate: async (options) => {
      calls.push({ system: undefined, prompt: options.prompt });
      return {
        content: [{ type: "text", text: JSON.stringify(value) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 20, text: 20, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
}

/** A model that always fails with the given HTTP status, for error-path tests. */
export function failingModel(statusCode: number, message = "boom"): LanguageModel {
  return new MockLanguageModelV3({
    doGenerate: async () => {
      throw new APICallError({
        message,
        url: "https://generativelanguage.googleapis.com/v1beta",
        requestBodyValues: {},
        statusCode,
        responseHeaders: statusCode === 429 ? { "retry-after": "30" } : undefined,
        isRetryable: false,
      });
    },
  });
}
