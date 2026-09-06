import { generateTurn, type AiError, type LanguageModel, type ModelMessage } from "@solarwave/ai";
import {
  DEFAULT_SETTINGS,
  err,
  ok,
  type AttemptOutcome,
  type Result,
  type ScoringSettings,
} from "@solarwave/core";
import type { TranscriptTurn } from "@solarwave/scoring";
import { CallState, type LiveAnswer } from "./callState";
import type { CallLanguage, ScriptCriterion } from "./criteria";
import { buildCallScript } from "./script";
import { toAiSdkTools, type EndCallReason } from "./tools";

export type { LiveAnswer } from "./callState";

/** Where the lead's replies come from: a scripted persona, an LLM, or a phone. */
export type Responder = (input: {
  /** Everything said so far, agent and lead. */
  transcript: TranscriptTurn[];
  /** What the agent just said. Empty when the turn was only tool calls. */
  agentTurn: string;
}) => Promise<string | null>;

export type ConversationResult = {
  transcript: TranscriptTurn[];
  outcome: AttemptOutcome;
  /** The reason the agent gave, or the one the loop imposed. */
  endedReason: EndCallReason;
  liveAnswers: LiveAnswer[];
  optedOut: boolean;
  minorFlagged: boolean;
  /** The time the lead asked to be called back, verbatim. Change 5 decides what to do with it. */
  requestedCallback: string | null;
  turnsUsed: number;
  /** True when the loop, not the agent, stopped the call. */
  cappedOut: boolean;
};

export type ConversationError = { kind: "model"; error: AiError; transcript: TranscriptTurn[] };

export type RunConversationInput = {
  model: LanguageModel;
  criteria: ScriptCriterion[];
  language: CallLanguage;
  respond: Responder;
  leadName?: string;
  settings?: ScoringSettings;
  /**
   * Hard cap on agent turns. Twelve is roughly two minutes of phone speech and
   * is what the eval scenarios run at; the wrap-up lands before it.
   */
  maxTurns?: number;
  temperature?: number;
};

const WRAP_UP =
  "System note: wrap up courteously on your next turn. Thank the lead, say a specialist will follow up, and call end_call.";

/**
 * Runs a text conversation to completion and returns the transcript in the
 * shape the extraction and judge steps already consume.
 *
 * The loop is written out rather than delegated to the SDK's agent loop
 * (design D1): it has to stop on `end_call`, honour an opt-out before anything
 * else, count turns against a budget and inject a wrap-up instruction — control
 * that is clearer here than configured elsewhere.
 */
export async function runConversation({
  model,
  criteria,
  language,
  respond,
  leadName,
  settings = DEFAULT_SETTINGS,
  maxTurns = 12,
  temperature,
}: RunConversationInput): Promise<Result<ConversationResult, ConversationError>> {
  const script = buildCallScript({ criteria, language, leadName });
  const tools = toAiSdkTools(script.order.map((c) => c.key));

  const transcript: TranscriptTurn[] = [];
  const messages: ModelMessage[] = [];
  // Which tool call wins and what an ending means are transport-neutral, so
  // they live in `CallState` and the voice session applies the same rules
  // (voice-bridge design D3).
  const state = new CallState({ order: script.order, settings });

  let endedReason: EndCallReason | null = null;
  /** The turn the wrap-up was injected on, or null while the call is still open. */
  let wrapUpAt: number | null = null;
  let turnsUsed = 0;

  while (turnsUsed < maxTurns) {
    const turn = await generateTurn({
      model,
      system: script.system,
      messages: messages.length > 0 ? messages : [{ role: "user", content: "(the lead has answered the phone)" }],
      tools,
      temperature,
    });
    if (!turn.ok) return err({ kind: "model", error: turn.error, transcript });

    turnsUsed += 1;
    const said = turn.value.text.trim();
    if (said.length > 0) transcript.push({ who: "ai", text: said });

    // Append the turn as the SDK modelled it, tool calls included, then answer
    // every call. A model that sees no record of its own tool calls repeats
    // them — silently, since the text was already spoken — until the turn cap
    // runs out, which is exactly what the first eval runs showed.
    messages.push(...turn.value.messages);
    if (turn.value.toolCalls.length > 0) {
      messages.push({
        role: "tool",
        content: turn.value.toolCalls.map((call) => ({
          type: "tool-result" as const,
          toolCallId: call.id,
          toolName: call.name,
          output: { type: "json" as const, value: { ok: true } },
        })),
      });
    }

    for (const call of turn.value.toolCalls) {
      state.apply({ name: call.name, input: call.input });
    }

    // Opt-out outranks everything, including an unanswered blocking criterion
    // and the agent's own idea of why the call is ending (spec section 6).
    endedReason = state.terminalReason();
    if (endedReason) break;

    // The wrap-up gives the agent exactly one turn to close courteously. If it
    // spends that turn on another question instead, the loop stops anyway —
    // otherwise the instruction would be advice the agent could ignore all the
    // way to the cap, and the budget would mean nothing.
    if (wrapUpAt !== null && turnsUsed > wrapUpAt) break;

    // It lands one turn before the cap, or as soon as there is nothing left
    // worth asking, so the call closes instead of being cut off mid-sentence.
    if (wrapUpAt === null && (state.enoughInformation() || turnsUsed >= maxTurns - 1)) {
      messages.push({ role: "user", content: WRAP_UP });
      wrapUpAt = turnsUsed;
      continue;
    }

    // A turn that produced only tool calls said nothing out loud. On a real call
    // the lead heard silence and would not answer, so asking the responder here
    // would invent a reply to nothing and fill the transcript with back-to-back
    // lead turns. Let the agent speak on its next turn instead; the turn is
    // still counted, so the cap keeps a silent model bounded.
    if (said.length === 0) continue;

    const reply = await respond({ transcript, agentTurn: said });
    if (reply === null) {
      endedReason = "lead_declined";
      break;
    }
    transcript.push({ who: "lead", text: reply });
    messages.push({ role: "user", content: reply });
  }

  const cappedOut = endedReason === null;
  const reason: EndCallReason = endedReason ?? state.reasonWhenCutOff();

  return ok({
    transcript,
    outcome: state.outcome(reason),
    endedReason: reason,
    liveAnswers: state.liveAnswers,
    optedOut: state.optedOut,
    minorFlagged: state.minorFlagged,
    requestedCallback: state.requestedCallback,
    turnsUsed,
    cappedOut,
  });
}
