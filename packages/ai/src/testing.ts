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

/** One scripted turn: what the model says, and which tools it calls saying it. */
export type FakeTurn = {
  text?: string;
  toolCalls?: { name: string; input: unknown }[];
};

/**
 * A model that plays a predetermined sequence of turns, one per call, and
 * records what it was sent.
 *
 * This is what lets the conversation loop, the early exit, the outcome mapping
 * and every deterministic guardrail assertion be tested at zero cost and with
 * no network (design D8). The last turn repeats once the script is exhausted,
 * so a test that only cares about the first few turns need not pad it.
 */
export function fakeToolCallingModel(turns: FakeTurn[], calls: FakeCall[] = []): LanguageModel {
  if (turns.length === 0) throw new Error("fakeToolCallingModel needs at least one turn");
  let index = 0;

  return new MockLanguageModelV3({
    doGenerate: async (options) => {
      calls.push({ system: undefined, prompt: options.prompt });
      const turn = turns[Math.min(index, turns.length - 1)]!;
      index += 1;

      const toolCalls = turn.toolCalls ?? [];
      return {
        content: [
          ...(turn.text ? [{ type: "text" as const, text: turn.text }] : []),
          ...toolCalls.map((call, n) => ({
            type: "tool-call" as const,
            toolCallId: `call-${index}-${n}`,
            toolName: call.name,
            // The SDK parses this against the tool's schema, so a test that
            // scripts an input the schema rejects fails here rather than
            // silently passing a malformed call to the loop.
            input: JSON.stringify(call.input),
          })),
        ],
        finishReason: {
          unified: toolCalls.length > 0 ? ("tool-calls" as const) : ("stop" as const),
          raw: undefined,
        },
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
