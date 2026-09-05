import { err, ok, type Result } from "@solarwave/core";
import { generateText, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import { toAiError, type AiError } from "./generate";

/**
 * A tool call the model made, flattened to what a caller needs to act on it.
 *
 * The AI SDK's typed tool calls carry a provider id and a discriminant this
 * project never uses; conversation code only ever asks "which tool, with what".
 */
export type AgentToolCall = {
  name: string;
  input: unknown;
  /**
   * Needed to answer the call. A provider that receives a tool call and never a
   * result for it either errors or keeps re-issuing the same call, so the id
   * has to survive this boundary.
   */
  id: string;
};

export type AgentTurn = {
  /** What the model said. Empty when the turn was nothing but tool calls. */
  text: string;
  toolCalls: AgentToolCall[];
  /**
   * The turn as the SDK modelled it, to append to the caller's history.
   *
   * Rebuilding an assistant message from `text` alone silently drops the tool
   * calls, which leaves the model with no record that it already called
   * anything — it then repeats the same call, in silence, until whatever cap
   * the caller has runs out.
   */
  messages: ModelMessage[];
};

export type GenerateTurnInput = {
  model: LanguageModel;
  system: string;
  /** The conversation so far. The caller owns the history, not this function. */
  messages: ModelMessage[];
  /**
   * Tools WITHOUT an `execute`, deliberately. An executable tool would make the
   * SDK run its own multi-step loop, and this project's loop has to stop on
   * `end_call`, count turns against a budget and inject a wrap-up instruction —
   * control that is clearer written out than configured (design D1).
   */
  tools?: ToolSet;
  /**
   * Defaults to 0.6. A conversation and a lead persona both read as broken at
   * 0; the linter passes 0 explicitly, because its job is to say the same thing
   * about the same question every time.
   */
  temperature?: number;
  maxRetries?: number;
  abortSignal?: AbortSignal;
};

/**
 * One turn of a multi-turn, tool-calling conversation.
 *
 * The counterpart to `generateStructured`, which stays exactly as it is: a
 * one-shot structured call at temperature 0. Generalising that function would
 * have put an optional `messages` and an optional `tools` on something whose
 * whole value is doing one thing. Two functions, one boundary — this module and
 * its sibling remain the only place in the monorepo that imports the SDK, which
 * is what makes every downstream test mockable.
 */
export async function generateTurn({
  model,
  system,
  messages,
  tools,
  temperature = 0.6,
  maxRetries = 2,
  abortSignal,
}: GenerateTurnInput): Promise<Result<AgentTurn, AiError>> {
  try {
    const result = await generateText({
      model,
      system,
      messages,
      tools,
      temperature,
      maxRetries,
      abortSignal,
    });

    return ok({
      text: result.text ?? "",
      toolCalls: result.toolCalls.map((call) => ({
        name: call.toolName,
        input: call.input,
        id: call.toolCallId,
      })),
      messages: result.response.messages as ModelMessage[],
    });
  } catch (cause) {
    return err(toAiError(cause));
  }
}
