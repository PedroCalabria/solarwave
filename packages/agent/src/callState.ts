import { hasEnoughInformation, type AttemptOutcome, type ScoringSettings } from "@solarwave/core";
import type { ScriptCriterion } from "./criteria";
import type { EndCallReason } from "./tools";

/**
 * The part of a call that does not depend on how the audio got there
 * (voice-bridge design D3).
 *
 * `loop.ts` owns two different things: counting turns, injecting the wrap-up on
 * a turn boundary and calling `respond()` are text-shaped and stay there. What
 * lives here is policy — which tool call wins, and what an ending means — and
 * the voice session needs exactly the same policy over a completely different
 * transport.
 *
 * The alternative was the voice session reimplementing `outcomeFor`, which was
 * private to `loop.ts`. The first time the mapping changed, a text call and a
 * voice call that ended for the same reason would have produced different
 * outcomes and different retries. This is the argument change 3's D2 made for
 * declaring the tools once, applied to the other half of the contract.
 */

/** What the agent recorded during the call. Advisory: extraction is the truth. */
export type LiveAnswer = { criterionKey: string; value: string };

/** Parsed `record_answer` input. Anything malformed is ignored, never guessed. */
export function readAnswer(input: unknown): LiveAnswer | null {
  if (typeof input !== "object" || input === null) return null;
  const { criterion_key: key, value } = input as { criterion_key?: unknown; value?: unknown };
  if (typeof key !== "string" || key.length === 0) return null;
  // The model omits `value` in practice even though the schema requires it —
  // measured against Gemini Live in the change 4 spike. Default, never invent.
  return { criterionKey: key, value: value === undefined || value === null ? "" : String(value) };
}

export function readReason(input: unknown): EndCallReason | null {
  if (typeof input !== "object" || input === null) return null;
  const { reason } = input as { reason?: unknown };
  return typeof reason === "string" ? (reason as EndCallReason) : null;
}

export function readCallbackTime(input: unknown): string | null {
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
export function outcomeFor(reason: EndCallReason, enoughInformation: boolean): AttemptOutcome {
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

export type CallStateInput = {
  /** The criteria the script actually asks, in call order. */
  order: ScriptCriterion[];
  settings: ScoringSettings;
};

/** A tool call as either transport hands it over: a name and parsed arguments. */
export type ToolInvocation = { name: string; input: unknown };

/**
 * Accumulates what the agent did during one call and decides what it means.
 *
 * Deliberately not a state machine over turns: the voice session has no turns
 * to count. It is a bag of facts plus the precedence rules between them.
 */
export class CallState {
  private readonly answers = new Map<string, LiveAnswer>();
  private readonly order: ScriptCriterion[];
  private readonly settings: ScoringSettings;

  optedOut = false;
  minorFlagged = false;
  /** The time the lead asked to be called back, verbatim. Change 5 decides what to do with it. */
  requestedCallback: string | null = null;
  /** The reason the agent gave, if it gave one. */
  statedReason: EndCallReason | null = null;

  constructor({ order, settings }: CallStateInput) {
    this.order = order;
    this.settings = settings;
  }

  /** Applies one tool call. Unknown names are ignored rather than thrown on. */
  apply({ name, input }: ToolInvocation): void {
    switch (name) {
      case "record_answer": {
        const answer = readAnswer(input);
        if (answer) this.answers.set(answer.criterionKey, answer);
        break;
      }
      case "mark_opt_out":
        this.optedOut = true;
        break;
      case "flag_minor":
        this.minorFlagged = true;
        break;
      case "request_callback":
        this.requestedCallback = readCallbackTime(input) ?? this.requestedCallback;
        break;
      case "end_call":
        // A missing reason is `incomplete` rather than a guess. Measured: the
        // model calls `end_call` with no arguments at all.
        this.statedReason = readReason(input) ?? "incomplete";
        break;
    }
  }

  get liveAnswers(): LiveAnswer[] {
    return [...this.answers.values()];
  }

  /** Spec section 4.5, via the configured answered-weight share. */
  enoughInformation(): boolean {
    return hasEnoughInformation(
      this.order,
      this.liveAnswers.map((a) => ({ criterionKey: a.criterionKey, value: a.value })),
      this.settings.minAnsweredWeightShare,
    );
  }

  /**
   * Whether the call must stop now, and why — checked after every tool call.
   *
   * Opt-out outranks everything, including an unanswered blocking criterion and
   * the agent's own idea of why the call is ending (spec section 6). A minor
   * ends the call after that. Only then does the agent's stated reason count.
   */
  terminalReason(): EndCallReason | null {
    if (this.optedOut) return "opt_out";
    if (this.statedReason) return this.statedReason;
    if (this.minorFlagged) return "minor";
    return null;
  }

  /**
   * The reason to record when the transport stopped the call itself — a turn
   * cap in text, a hard stop in voice — and the agent never closed.
   */
  reasonWhenCutOff(): EndCallReason {
    return this.terminalReason() ?? (this.enoughInformation() ? "enough_information" : "incomplete");
  }

  outcome(reason: EndCallReason): AttemptOutcome {
    return outcomeFor(reason, this.enoughInformation());
  }
}
