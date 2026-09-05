import { generateTurn, type AiError, type LanguageModel, type ModelMessage } from "@solarwave/ai";
import {
  DEFAULT_SETTINGS,
  err,
  hasEnoughInformation,
  ok,
  type AttemptOutcome,
  type Result,
  type ScoringSettings,
} from "@solarwave/core";
import type { TranscriptTurn } from "@solarwave/scoring";
import type { CallLanguage, ScriptCriterion } from "./criteria";
import { buildCallScript } from "./script";
import { toAiSdkTools, type EndCallReason } from "./tools";

/** Where the lead's replies come from: a scripted persona, an LLM, or a phone. */
export type Responder = (input: {
  /** Everything said so far, agent and lead. */
  transcript: TranscriptTurn[];
  /** What the agent just said. Empty when the turn was only tool calls. */
  agentTurn: string;
}) => Promise<string | null>;

/** What the agent recorded during the call. Advisory: extraction is the truth. */
export type LiveAnswer = { criterionKey: string; value: string };

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

/** Parsed `record_answer` input. Anything malformed is ignored, never guessed. */
function readAnswer(input: unknown): LiveAnswer | null {
  if (typeof input !== "object" || input === null) return null;
  const { criterion_key: key, value } = input as { criterion_key?: unknown; value?: unknown };
  if (typeof key !== "string" || key.length === 0) return null;
  return { criterionKey: key, value: value === undefined || value === null ? "" : String(value) };
}

function readReason(input: unknown): EndCallReason | null {
  if (typeof input !== "object" || input === null) return null;
  const { reason } = input as { reason?: unknown };
  return typeof reason === "string" ? (reason as EndCallReason) : null;
}

function readCallbackTime(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null;
  const { preferred_time: time } = input as { preferred_time?: unknown };
  return typeof time === "string" && time.trim().length > 0 ? time.trim() : null;
}

/**
 * Maps how the call ended to the attempt outcome the lifecycle understands.
 *
 * `blocking_failed` maps to `answered_complete` on purpose. The weight share
 * will be low — the agent stopped asking after the blocking question — so
 * `hasEnoughInformation` would say the call was incomplete and the lead would
 * be called back. But a lead who fails a blocking criterion is disqualified
 * whatever the rest of the answers say, which is exactly what `scoreLead` does
 * with `failedBlocking`. Calling a renter a second time to confirm they still
 * rent is the outcome this mapping exists to prevent.
 */
function outcomeFor(reason: EndCallReason, enoughInformation: boolean): AttemptOutcome {
  switch (reason) {
    case "opt_out":
      return "opt_out";
    case "minor":
      return "minor_answered";
    case "hostile":
      return "abusive";
    case "blocking_failed":
      return "answered_complete";
    case "enough_information":
      return enoughInformation ? "answered_complete" : "answered_incomplete";
    case "callback_requested":
    case "lead_declined":
    case "incomplete":
      return "answered_incomplete";
  }
}

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
  const liveAnswers = new Map<string, LiveAnswer>();

  let optedOut = false;
  let minorFlagged = false;
  let requestedCallback: string | null = null;
  let endedReason: EndCallReason | null = null;
  /** The turn the wrap-up was injected on, or null while the call is still open. */
  let wrapUpAt: number | null = null;
  let turnsUsed = 0;

  const enough = () =>
    hasEnoughInformation(
      script.order,
      [...liveAnswers.values()].map((a) => ({ criterionKey: a.criterionKey, value: a.value })),
      settings.minAnsweredWeightShare,
    );

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
      switch (call.name) {
        case "record_answer": {
          const answer = readAnswer(call.input);
          if (answer) liveAnswers.set(answer.criterionKey, answer);
          break;
        }
        case "mark_opt_out":
          optedOut = true;
          break;
        case "flag_minor":
          minorFlagged = true;
          break;
        case "request_callback":
          requestedCallback = readCallbackTime(call.input) ?? requestedCallback;
          break;
        case "end_call":
          endedReason = readReason(call.input) ?? "incomplete";
          break;
      }
    }

    // Opt-out outranks everything, including an unanswered blocking criterion
    // and the agent's own idea of why the call is ending (spec section 6).
    if (optedOut) {
      endedReason = "opt_out";
      break;
    }
    if (endedReason) break;
    if (minorFlagged) {
      endedReason = "minor";
      break;
    }

    // The wrap-up gives the agent exactly one turn to close courteously. If it
    // spends that turn on another question instead, the loop stops anyway —
    // otherwise the instruction would be advice the agent could ignore all the
    // way to the cap, and the budget would mean nothing.
    if (wrapUpAt !== null && turnsUsed > wrapUpAt) break;

    // It lands one turn before the cap, or as soon as there is nothing left
    // worth asking, so the call closes instead of being cut off mid-sentence.
    if (wrapUpAt === null && (enough() || turnsUsed >= maxTurns - 1)) {
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
  const reason: EndCallReason = endedReason ?? (enough() ? "enough_information" : "incomplete");

  return ok({
    transcript,
    outcome: outcomeFor(reason, enough()),
    endedReason: reason,
    liveAnswers: [...liveAnswers.values()],
    optedOut,
    minorFlagged,
    requestedCallback,
    turnsUsed,
    cappedOut,
  });
}
