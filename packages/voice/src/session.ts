import {
  buildCallScript,
  CallState,
  toFunctionDeclarations,
  type CallLanguage,
  type EndCallReason,
  type LiveAnswer,
  type ScriptCriterion,
} from "@solarwave/agent";
import { DEFAULT_SETTINGS, type AttemptOutcome, type ScoringSettings } from "@solarwave/core";
import type { TranscriptTurn } from "@solarwave/scoring";
import type { LiveConnection, LiveEvent, LiveTransport } from "./transport";

/**
 * One realtime qualification call, independent of how the audio reaches it.
 *
 * The browser harness drives this with microphone PCM and the Twilio bridge
 * drives it with resampled telephony audio; neither knows anything the other
 * does not. Everything about *what the call means* — which tool call wins, when
 * there is enough information, what the ending maps to — is delegated to
 * `CallState` in `@solarwave/agent`, so a voice call and a text call that end
 * the same way produce the same outcome (voice-bridge design D3).
 */

export const DEFAULT_WRAP_UP_SECONDS = 90;
export const DEFAULT_MAX_CALL_SECONDS = 180;

/**
 * Injected at the wrap-up mark. Not spoken: it is an instruction to the model,
 * in the frame's language, and the model answers it in the lead's.
 */
export const WRAP_UP_INSTRUCTION =
  "System note: wrap up courteously on your next turn. Thank the lead, say a specialist will follow up, and call end_call.";

/**
 * Sent once the session is ready, to make the agent open the call.
 *
 * The voice frame tells it to speak first, but a Live session generates
 * nothing until something arrives — measured in the change 4 spike, where the
 * model stayed silent until a turn was pushed at it. On a real call the lead
 * has genuinely just picked up, so this states that, exactly as the text loop
 * does with the same wording.
 */
export const OPENING_CUE = "(the lead has answered the phone)";

export type VoiceSessionEvent =
  /** Agent audio to play or forward, PCM16 at the model's output rate. */
  | { type: "audio"; pcm: Int16Array }
  /** The transcript changed. The array is a snapshot, safe to persist. */
  | { type: "transcript"; turns: TranscriptTurn[] }
  /** Barge-in: drop whatever agent audio is buffered downstream, now. */
  | { type: "interrupted" }
  /** A tool the agent invoked, after it has been applied to the call state. */
  | { type: "tool"; name: string; input: unknown }
  | { type: "ended"; result: VoiceCallResult };

export type VoiceCallResult = {
  transcript: TranscriptTurn[];
  outcome: AttemptOutcome;
  endedReason: EndCallReason;
  liveAnswers: LiveAnswer[];
  optedOut: boolean;
  minorFlagged: boolean;
  requestedCallback: string | null;
  /** True when a timer stopped the call rather than the agent. */
  cutOff: boolean;
  durationSeconds: number;
};

export type StartVoiceSessionInput = {
  transport: LiveTransport;
  model: string;
  criteria: ScriptCriterion[];
  language: CallLanguage;
  leadName?: string;
  settings?: ScoringSettings;
  wrapUpSeconds?: number;
  maxCallSeconds?: number;
  /** The rate the audio handed to `sendAudio` is sampled at. */
  inputRate?: number;
  onEvent: (event: VoiceSessionEvent) => void;
};

export type VoiceSession = {
  /** Lead audio, PCM16 at `inputRate`. Ignored once the call has ended. */
  sendAudio(pcm: Int16Array): void;
  /** Ends the call as if a timer had: used when the phone hangs up. */
  stop(reason?: EndCallReason): void;
  readonly transcript: TranscriptTurn[];
  readonly ended: boolean;
};

/** Accumulates transcription fragments into turns, one speaker at a time. */
class TranscriptBuilder {
  private readonly turns: TranscriptTurn[] = [];
  private open: TranscriptTurn | null = null;

  add(who: "ai" | "lead", text: string): boolean {
    if (text.length === 0) return false;
    if (this.open && this.open.who === who) {
      this.open.text += text;
      return true;
    }
    this.open = { who, text };
    this.turns.push(this.open);
    return true;
  }

  /**
   * Marks the open agent turn as interrupted, keeping its text in full.
   *
   * Truncating would hide words the model produced from the guardrail judge; a
   * price quote the lead talked over is still a section 6 violation, and a
   * judge that never sees it never flags it (design D8).
   */
  markInterrupted(): boolean {
    if (!this.open || this.open.who !== "ai") return false;
    this.open.interrupted = true;
    return true;
  }

  /** Ends the current turn, so the next fragment starts a new one. */
  close(): void {
    this.open = null;
  }

  snapshot(): TranscriptTurn[] {
    return this.turns.map((t) => ({ ...t }));
  }
}

export async function startVoiceSession({
  transport,
  model,
  criteria,
  language,
  leadName,
  settings = DEFAULT_SETTINGS,
  wrapUpSeconds = DEFAULT_WRAP_UP_SECONDS,
  maxCallSeconds = DEFAULT_MAX_CALL_SECONDS,
  inputRate = 16000,
  onEvent,
}: StartVoiceSessionInput): Promise<VoiceSession> {
  const script = buildCallScript({ criteria, language, leadName, medium: "voice" });
  const state = new CallState({ order: script.order, settings });
  const transcript = new TranscriptBuilder();
  const startedAt = Date.now();

  let connection: LiveConnection | null = null;
  let ended = false;
  /**
   * True while the model is producing a turn. Measured in the change 4 spike:
   * pushing client content mid-generation kills the socket with a 1011, so the
   * wrap-up waits for `turn_complete` rather than firing on its timer.
   */
  let generating = false;
  let openingCuePending = false;
  let wrapUpPending = false;
  let wrapUpSent = false;
  let wrapUpTimer: ReturnType<typeof setTimeout> | undefined;
  let hardStopTimer: ReturnType<typeof setTimeout> | undefined;

  const emitTranscript = () => onEvent({ type: "transcript", turns: transcript.snapshot() });

  const finish = (reason: EndCallReason, cutOff: boolean) => {
    if (ended) return;
    ended = true;
    clearTimeout(wrapUpTimer);
    clearTimeout(hardStopTimer);
    transcript.close();
    connection?.close();
    onEvent({
      type: "ended",
      result: {
        transcript: transcript.snapshot(),
        outcome: state.outcome(reason),
        endedReason: reason,
        liveAnswers: state.liveAnswers,
        optedOut: state.optedOut,
        minorFlagged: state.minorFlagged,
        requestedCallback: state.requestedCallback,
        cutOff,
        durationSeconds: Math.round((Date.now() - startedAt) / 1000),
      },
    });
  };

  const sendWrapUp = () => {
    if (ended || wrapUpSent || generating) return;
    wrapUpSent = true;
    wrapUpPending = false;
    connection?.sendText(WRAP_UP_INSTRUCTION);
  };

  /** Asks for the wrap-up, now if the model is idle, otherwise after its turn. */
  const requestWrapUp = () => {
    if (ended || wrapUpSent) return;
    wrapUpPending = true;
    sendWrapUp();
  };

  const handle = (event: LiveEvent) => {
    if (ended) return;

    switch (event.type) {
      case "audio":
        generating = true;
        onEvent({ type: "audio", pcm: event.pcm });
        break;

      case "agent_said":
        generating = true;
        if (transcript.add("ai", event.text)) emitTranscript();
        break;

      case "lead_said":
        if (transcript.add("lead", event.text)) emitTranscript();
        break;

      case "interrupted":
        generating = false;
        if (transcript.markInterrupted()) emitTranscript();
        transcript.close();
        onEvent({ type: "interrupted" });
        break;

      case "tool_call": {
        state.apply({ name: event.name, input: event.input });
        onEvent({ type: "tool", name: event.name, input: event.input });
        // Always answer, even for a tool that does nothing: a model that cannot
        // see a result for its own call reissues it, silently, until something
        // else stops the call. Change 3 learned this over text; it is no
        // different here.
        connection?.sendToolResponse([{ id: event.id, name: event.name, output: { ok: true } }]);

        const terminal = state.terminalReason();
        if (terminal) {
          // The agent still has to say goodbye, so the call is not cut here.
          // `end_call` is its last action, and the provider closes after it.
          finish(terminal, false);
        }
        break;
      }

      case "turn_complete":
        generating = false;
        transcript.close();
        if (wrapUpPending) sendWrapUp();
        // Nothing left worth asking: close early rather than filling the budget.
        else if (!wrapUpSent && state.enoughInformation()) requestWrapUp();
        break;

      case "error":
        // The transport is gone; the outcome is whatever the call had earned.
        finish(state.reasonWhenCutOff(), true);
        break;

      case "closed":
        finish(state.terminalReason() ?? state.reasonWhenCutOff(), state.terminalReason() === null);
        break;

      case "setup_complete":
        // `connect` may resolve after the provider's first messages arrive, so
        // the cue is held until there is something to send it down.
        if (connection) connection.sendText(OPENING_CUE);
        else openingCuePending = true;
        break;

      case "open":
        break;
    }
  };

  connection = await transport({
    model,
    systemInstruction: script.system,
    functionDeclarations: toFunctionDeclarations(script.order.map((c) => c.key)),
    onEvent: handle,
  });

  if (openingCuePending) {
    openingCuePending = false;
    connection.sendText(OPENING_CUE);
  }

  wrapUpTimer = setTimeout(requestWrapUp, wrapUpSeconds * 1000);
  hardStopTimer = setTimeout(() => finish(state.reasonWhenCutOff(), true), maxCallSeconds * 1000);

  return {
    sendAudio(pcm) {
      if (!ended) connection?.sendAudio(pcm, inputRate);
    },
    stop(reason) {
      finish(reason ?? state.terminalReason() ?? state.reasonWhenCutOff(), reason === undefined);
    },
    get transcript() {
      return transcript.snapshot();
    },
    get ended() {
      return ended;
    },
  };
}
