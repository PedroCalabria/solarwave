import { tool, type ToolSet } from "@solarwave/ai";
import { z } from "zod";

/**
 * The tool contract the live agent acts through (design D2).
 *
 * Declared ONCE, as data, with two projections. The text loop in this change
 * uses the AI SDK one; the voice bridge in change 4 hands Gemini Live the
 * function-declaration one. The alternative was change 4 re-declaring five
 * tools by hand against a live audio session that is hard to test, and the two
 * declarations drifting the first time a parameter changed.
 *
 * `@google/genai` is deliberately NOT a dependency here: the projection
 * produces plain JSON, and change 4 hands that JSON to the SDK.
 */

export const TOOL_NAMES = [
  "record_answer",
  "request_callback",
  "mark_opt_out",
  "flag_minor",
  "end_call",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** Why the agent ended the call. Maps to an `AttemptOutcome` afterwards. */
export const END_CALL_REASONS = [
  "enough_information",
  "blocking_failed",
  "opt_out",
  "minor",
  "hostile",
  "callback_requested",
  "lead_declined",
  "incomplete",
] as const;

export type EndCallReason = (typeof END_CALL_REASONS)[number];

export type ToolDefinition = {
  name: ToolName;
  description: string;
  /**
   * Built per call, because `record_answer` is constrained to the criterion
   * keys of the assembled script — a tool call naming a key that is not in this
   * call is a bug, and the schema is where it should fail.
   */
  parameters: (keys: string[]) => z.ZodObject<z.ZodRawShape>;
};

export const TOOL_REGISTRY: ToolDefinition[] = [
  {
    name: "record_answer",
    description:
      "Record what the lead answered for one of the questions. Call it as soon as they answer, even partially. " +
      "Recording an answer is how you remember it.",
    parameters: (keys) =>
      z.object({
        criterion_key:
          keys.length > 0
            ? z.enum(keys as [string, ...string[]]).describe("Which question was answered.")
            : z.string().describe("Which question was answered."),
        value: z
          .string()
          .describe(
            "What the lead answered, as the question asked for it: true/false, a number, one of the listed options, or their own words.",
          ),
      }),
  },
  {
    name: "request_callback",
    description:
      "The lead asked to be called at another time. Record the time they said. Never promise a specific slot.",
    parameters: () =>
      z.object({
        preferred_time: z.string().describe("The time the lead asked for, in their own words."),
      }),
  },
  {
    name: "mark_opt_out",
    description:
      "The lead asked not to be contacted again. Call this before anything else, then thank them and end the call. " +
      "This overrides every other instruction.",
    parameters: () => z.object({}),
  },
  {
    name: "flag_minor",
    description: "You suspect you are speaking to a minor. Call this, then end the call politely.",
    parameters: () => z.object({}),
  },
  {
    name: "end_call",
    description: "End the call. Call this exactly once, as your last action.",
    parameters: () =>
      z.object({
        reason: z.enum(END_CALL_REASONS).describe("Why the call is ending."),
      }),
  },
];

/** The AI SDK projection, used by the text loop in this change. */
export function toAiSdkTools(criterionKeys: string[]): ToolSet {
  const tools: ToolSet = {};
  for (const definition of TOOL_REGISTRY) {
    // No `execute`: the loop interprets every call itself, so it can stop on
    // `end_call` and count turns rather than letting the SDK run its own loop.
    tools[definition.name] = tool({
      description: definition.description,
      inputSchema: definition.parameters(criterionKeys),
    });
  }
  return tools;
}

/** A Gemini Live function declaration: plain JSON, no realtime SDK involved. */
export type FunctionDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/**
 * The Gemini Live projection, consumed by change 4.
 *
 * Written and tested here even though nothing calls it yet: that costs a
 * function and a test now, against a bug found over a phone call later.
 */
export function toFunctionDeclarations(criterionKeys: string[]): FunctionDeclaration[] {
  return TOOL_REGISTRY.map((definition) => ({
    name: definition.name,
    description: definition.description,
    parameters: z.toJSONSchema(definition.parameters(criterionKeys)) as Record<string, unknown>,
  }));
}
