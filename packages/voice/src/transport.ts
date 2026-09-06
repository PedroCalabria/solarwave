import {
  ActivityHandling,
  EndSensitivity,
  GoogleGenAI,
  Modality,
  StartSensitivity,
  type LiveServerMessage,
  type Session,
} from "@google/genai";
import type { FunctionDeclaration } from "@solarwave/agent";
import { pcm16Bytes } from "./audio";

/**
 * The realtime provider, behind an interface (voice-bridge design D2).
 *
 * The session logic — timers, transcript accumulation, tool precedence, the
 * end reason — is the part that has to be right, and it is the part a live
 * audio socket makes almost impossible to test. So the socket is one small
 * interface with two implementations: this file's Gemini one, and a scripted
 * fake in the tests.
 */

/** What the session needs to hear from the provider, in provider-neutral form. */
export type LiveEvent =
  | { type: "open" }
  | { type: "setup_complete" }
  /** PCM16 at the model's output rate. */
  | { type: "audio"; pcm: Int16Array; mimeType?: string }
  | { type: "lead_said"; text: string }
  | { type: "agent_said"; text: string }
  | { type: "tool_call"; id?: string; name: string; input: unknown }
  /** The lead talked over the agent; whatever is buffered must be dropped. */
  | { type: "interrupted" }
  /** The model finished a turn. Nothing may be pushed at it before this. */
  | { type: "turn_complete" }
  | { type: "error"; message: string }
  | { type: "closed"; code?: number; reason?: string };

export type LiveConnectOptions = {
  model: string;
  systemInstruction: string;
  functionDeclarations: FunctionDeclaration[];
  onEvent: (event: LiveEvent) => void;
  /** Overrides the voice-activity defaults below. */
  vad?: Partial<VoiceActivityTuning>;
};

export type VoiceActivityTuning = {
  /** Silence, in ms, before the model decides the lead has finished speaking. */
  silenceDurationMs: number;
  /** Speech, in ms, before the model decides the lead has started. */
  prefixPaddingMs: number;
};

/**
 * Tuned for a telephone conversation, not for a dictation app.
 *
 * The SDK's own note on `silenceDurationMs` is the whole story: "the larger
 * this value ... this will increase the model's latency". Left at its default,
 * the first real harness session sat silent for sixteen seconds before the
 * agent spoke and twenty to thirty between questions, on a microphone the
 * transcript showed was picking up constant `<noise>` — so the detector rarely
 * saw a gap long enough to call the turn over.
 *
 * 700 ms is roughly the pause a person leaves at the end of a sentence and
 * still tolerates being answered into. Configurable, because the right value on
 * an eight-kilohertz phone line is not obviously the right value on a laptop
 * microphone, and this is now measurable rather than guessed.
 */
export const DEFAULT_VAD: VoiceActivityTuning = {
  silenceDurationMs: 700,
  prefixPaddingMs: 200,
};

export type LiveConnection = {
  /** Lead audio, PCM16 at the model's input rate. */
  sendAudio(pcm: Int16Array, rate: number): void;
  /** An instruction from us, never from the lead. Only between turns. */
  sendText(text: string): void;
  /**
   * Seeds a conversation that already happened, then asks for the next turn.
   *
   * Only the evaluation uses this: a probe needs the agent to answer a specific
   * provocation with the right context behind it, without spending a whole
   * conversation getting there.
   */
  sendHistory(turns: { role: "user" | "model"; text: string }[]): void;
  sendToolResponse(calls: { id?: string; name: string; output: Record<string, unknown> }[]): void;
  close(): void;
};

export type LiveTransport = (options: LiveConnectOptions) => Promise<LiveConnection>;

/**
 * The Gemini Live transport.
 *
 * MEASURED 2026-09-05, and the reason the model id is a parameter rather than a
 * constant: only `gemini-2.5-flash-native-audio-preview-09-2025` can call a
 * function. On `preview-12-2025` and on the `-latest` alias the socket dies
 * with a 1011 the instant the model tries, after producing correct audio and
 * transcription — so the failure looks like a network problem and is not one.
 */
export function geminiTransport(apiKey: string): LiveTransport {
  return async ({ model, systemInstruction, functionDeclarations, onEvent, vad }) => {
    const activity = { ...DEFAULT_VAD, ...vad };
    const ai = new GoogleGenAI({ apiKey });

    const session: Session = await ai.live.connect({
      model,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction,
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        tools: [{ functionDeclarations }],
        realtimeInputConfig: {
          automaticActivityDetection: {
            startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
            endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
            prefixPaddingMs: activity.prefixPaddingMs,
            silenceDurationMs: activity.silenceDurationMs,
          },
          // The lead talking over the agent stops the agent. That is what a
          // person expects on a phone, and the bridge already flushes the
          // audio Twilio has buffered when it happens.
          activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
        },
      },
      callbacks: {
        onopen: () => onEvent({ type: "open" }),
        onmessage: (message: LiveServerMessage) => {
          if (message.setupComplete) onEvent({ type: "setup_complete" });

          const content = message.serverContent;
          if (content?.inputTranscription?.text) {
            onEvent({ type: "lead_said", text: content.inputTranscription.text });
          }
          if (content?.outputTranscription?.text) {
            onEvent({ type: "agent_said", text: content.outputTranscription.text });
          }
          if (content?.interrupted) onEvent({ type: "interrupted" });

          for (const part of content?.modelTurn?.parts ?? []) {
            const inline = part.inlineData;
            if (!inline?.data) continue;
            onEvent({
              type: "audio",
              pcm: samplesFrom(Buffer.from(inline.data, "base64")),
              mimeType: inline.mimeType,
            });
          }

          for (const call of message.toolCall?.functionCalls ?? []) {
            if (!call.name) continue;
            onEvent({ type: "tool_call", id: call.id, name: call.name, input: call.args });
          }

          if (content?.turnComplete) onEvent({ type: "turn_complete" });
        },
        onerror: (e: { message?: string }) => onEvent({ type: "error", message: String(e.message ?? e) }),
        onclose: (e: { code?: number; reason?: string }) =>
          onEvent({ type: "closed", code: e.code, reason: e.reason }),
      },
    });

    return {
      sendAudio(pcm, rate) {
        session.sendRealtimeInput({
          audio: { data: pcm16Bytes(pcm).toString("base64"), mimeType: `audio/pcm;rate=${rate}` },
        });
      },
      sendText(text) {
        session.sendClientContent({ turns: [{ role: "user", parts: [{ text }] }], turnComplete: true });
      },
      sendHistory(turns) {
        session.sendClientContent({
          turns: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
          turnComplete: true,
        });
      },
      sendToolResponse(calls) {
        session.sendToolResponse({
          functionResponses: calls.map((c) => ({ id: c.id, name: c.name, response: c.output })),
        });
      },
      close() {
        session.close();
      },
    };
  };
}

/** Little-endian PCM16 bytes as samples, copied so an odd pool offset is safe. */
function samplesFrom(bytes: Buffer): Int16Array {
  const out = new Int16Array(bytes.length >> 1);
  for (let i = 0; i < out.length; i += 1) out[i] = bytes.readInt16LE(i * 2);
  return out;
}
