/**
 * Spike (voice-bridge tasks 1.2 and 1.3) — is a native-audio Live session
 * reachable on the free tier, and does it behave the way the design assumes?
 *
 * Answers, on the wire rather than from documentation:
 *   - does the session open at all, and with which model id;
 *   - what sample rate and encoding the output audio actually uses;
 *   - whether output transcription arrives;
 *   - whether function calling works with `toFunctionDeclarations()`, the
 *     projection change 3 wrote for exactly this and never got to run;
 *   - what an exhausted quota looks like.
 *
 * Input-audio transcription is NOT covered here: it needs real speech, which
 * the browser harness (task 7) supplies. This spike sends a text turn.
 *
 * It was written as a throwaway and has earned a permanent place instead. It
 * shares no code with `session.ts`, the transport or the eval, which makes it
 * the one thing that can tell "our bridge is broken" apart from "the account
 * cannot serve a realtime session right now". It did exactly that twice: it
 * returned nothing at all on an exhausted allowance, and produced 242 audio
 * chunks the next morning on a fresh one.
 *
 *   pnpm --filter @solarwave/voice spike:live
 *
 * Reach for it FIRST whenever the voice path misbehaves. One session, and it
 * costs a guess otherwise spent on the wrong half of the system.
 */

import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import { toFunctionDeclarations } from "@solarwave/agent";

const MODEL = process.env.AGENT_MODEL_VOICE ?? "gemini-2.5-flash-native-audio-preview-12-2025";
/** none | raw | sanitized — which tool declarations to hand the Live API. */
const TOOLS_MODE = process.env.SPIKE_TOOLS ?? "raw";

/**
 * Gemini's function-declaration schema is a subset of OpenAPI 3.0. It has no
 * `$schema` and no `additionalProperties`, and `z.toJSONSchema()` emits both.
 * A tool with no parameters must omit `parameters` entirely rather than send an
 * empty object.
 */
function sanitize(declarations: ReturnType<typeof toFunctionDeclarations>) {
  return declarations.map((d) => {
    const p = { ...(d.parameters as Record<string, unknown>) };
    delete p.$schema;
    delete p.additionalProperties;
    const props = p.properties as Record<string, unknown> | undefined;
    if (!props || Object.keys(props).length === 0) {
      return { name: d.name, description: d.description };
    }
    return { name: d.name, description: d.description, parameters: p };
  });
}
const CRITERION_KEYS = ["homeowner", "monthly_bill", "timeline"];

const SYSTEM = `You are Ana, an AI assistant calling on behalf of Soltera, a residential solar company.
You must say you are an AI at the start of the call.
Ask the lead whether they own the property they live in.
As soon as they answer, call record_answer with criterion_key "homeowner".
Never quote prices. Speak Brazilian Portuguese. Keep turns short.`;

type Report = {
  connected: boolean;
  setupComplete: boolean;
  audioChunks: number;
  audioBytes: number;
  audioMimeTypes: Set<string>;
  outputTranscript: string;
  toolCalls: { name: string; args: unknown }[];
  turnComplete: boolean;
  interrupted: boolean;
  usage: unknown;
  error: string | null;
  closeReason: string | null;
};

async function main() {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set");

  const declarations = toFunctionDeclarations(CRITERION_KEYS);
  console.log(`model:  ${MODEL}`);
  console.log(`tools:  ${declarations.map((d) => d.name).join(", ")}\n`);

  const report: Report = {
    connected: false,
    setupComplete: false,
    audioChunks: 0,
    audioBytes: 0,
    audioMimeTypes: new Set(),
    outputTranscript: "",
    toolCalls: [],
    turnComplete: false,
    interrupted: false,
    usage: null,
    error: null,
    closeReason: null,
  };

  const ai = new GoogleGenAI({ apiKey });
  let done: () => void;
  const finished = new Promise<void>((resolve) => {
    done = resolve;
  });

  let session: Session;
  let answered = false;
  try {
    session = await ai.live.connect({
      model: MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: SYSTEM,
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        ...(TOOLS_MODE === "none" ? {} : { tools: [{ functionDeclarations: declarations }] }),
      },
      callbacks: {
        onopen: () => {
          report.connected = true;
          console.log("· socket open");
        },
        onmessage: (message: LiveServerMessage) => {
          if (message.setupComplete) {
            report.setupComplete = true;
            console.log("· setup complete");
          }

          const content = message.serverContent;
          if (content?.outputTranscription?.text) {
            report.outputTranscript += content.outputTranscription.text;
          }
          if (content?.interrupted) report.interrupted = true;

          for (const part of content?.modelTurn?.parts ?? []) {
            const inline = part.inlineData;
            if (!inline?.data) continue;
            report.audioChunks += 1;
            report.audioBytes += Buffer.from(inline.data, "base64").byteLength;
            if (inline.mimeType) report.audioMimeTypes.add(inline.mimeType);
          }

          for (const call of message.toolCall?.functionCalls ?? []) {
            report.toolCalls.push({ name: call.name ?? "(unnamed)", args: call.args });
            console.log(`· tool call: ${call.name} ${JSON.stringify(call.args)}`);
            // Answer it. A model that cannot see a result for its own call
            // reissues it — the lesson change 3 recorded, tested here.
            session.sendToolResponse({
              functionResponses: [{ id: call.id, name: call.name, response: { ok: true } }],
            });
          }

          if (message.usageMetadata) report.usage = message.usageMetadata;

          if (content?.turnComplete) {
            report.turnComplete = true;
            console.log("· turn complete");
            // Only now. Pushing client content while the model is still
            // generating killed the session with a 1011 on the first run of
            // this spike — a finding the bridge has to respect.
            if (!answered) {
              answered = true;
              session.sendClientContent({
                turns: [{ role: "user", parts: [{ text: "Sim, a casa é minha mesmo, eu que comprei." }] }],
                turnComplete: true,
              });
              console.log("· sent the lead's answer");
            } else {
              setTimeout(() => {
                session.close();
                done();
              }, 1500);
            }
          }
        },
        onerror: (e: { message?: string }) => {
          report.error = String(e.message ?? e);
          console.log(`· error: ${report.error}`);
          done();
        },
        onclose: (e: { code?: number; reason?: string }) => {
          report.closeReason = `${e.code} ${e.reason}`.trim();
          console.log(`· closed: ${report.closeReason}`);
          done();
        },
      },
    });
  } catch (e) {
    console.error("\nCONNECT FAILED — this is task 1.3's stop condition.");
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
    return;
  }

  // The lead speaks first here only because this spike sends text rather than
  // audio; on a real call the agent opens with the AI disclosure.
  session.sendClientContent({
    turns: [{ role: "user", parts: [{ text: "Alô? Quem fala?" }] }],
    turnComplete: true,
  });

  // Backstop only; the conversation drives itself from turnComplete.
  setTimeout(() => {
    session.close();
    done();
  }, 25000);

  await finished;

  console.log("\n──────── spike report ────────");
  console.log(`connected            ${report.connected}`);
  console.log(`setup complete       ${report.setupComplete}`);
  console.log(`audio chunks         ${report.audioChunks}`);
  console.log(`audio bytes          ${report.audioBytes}`);
  console.log(`audio mime types     ${[...report.audioMimeTypes].join(", ") || "(none)"}`);
  console.log(`output transcript    ${report.outputTranscript ? JSON.stringify(report.outputTranscript) : "(none)"}`);
  console.log(`tool calls           ${report.toolCalls.length ? JSON.stringify(report.toolCalls) : "(none)"}`);
  console.log(`turn complete        ${report.turnComplete}`);
  console.log(`interrupted          ${report.interrupted}`);
  console.log(`usage                ${JSON.stringify(report.usage)}`);
  console.log(`error                ${report.error ?? "(none)"}`);
  console.log(`close                ${report.closeReason ?? "(none)"}`);

  const ok = report.setupComplete && report.audioChunks > 0 && report.outputTranscript.length > 0;
  console.log(`\nverdict: ${ok ? "native audio reachable on this key" : "INCOMPLETE — see task 1.3"}`);
  process.exitCode = ok ? 0 : 1;
}

void main();
