import { experimental_upgradeWebSocket, type WebSocket, type WebSocketData } from "@vercel/functions";
import { hasApiKey, requireApiKey, requireModelId } from "@solarwave/ai";
import { getDb, listActiveCriteria } from "@solarwave/db";
import { geminiTransport, startVoiceSession, pcm16Bytes, type VoiceSession } from "@solarwave/voice";
import type { ScriptCriterion } from "@solarwave/agent/criteria";
import { getCurrentEmployee } from "@/lib/auth";

/**
 * The browser microphone harness (voice-bridge design D1, task 7).
 *
 * The same realtime session the telephone path runs, driven by a microphone
 * instead of Twilio. It exists so the Gemini half and the telephony half fail
 * for separable reasons: when a call misbehaves after Twilio lands, this page
 * says whether the conversation itself was already wrong, and it costs no
 * telephony minutes to ask.
 *
 * NOTHING here writes a lead attempt. A harness session is a rehearsal: no
 * `call_attempts` row, no lead transition, no scoring (voice-harness spec).
 *
 * `next dev` will not serve this route — it does not perform the WebSocket
 * upgrade. Run `pnpm dev:voice`.
 */

/** Browser to server: PCM16 mono at this rate. The client sets it explicitly. */
const CAPTURE_RATE = 16000;

type ClientMessage = { type: "stop" };

export async function GET(request: Request) {
  // The upgrade is an ordinary GET, so the session cookie is present and the
  // usual data-access layer applies. Admin-only: a harness session spends
  // realtime model quota.
  const employee = await getCurrentEmployee();
  if (!employee) return new Response("unauthorised", { status: 401 });
  if (employee.role !== "admin") return new Response("forbidden", { status: 403 });

  if (!hasApiKey()) return new Response("no model API key is configured", { status: 503 });

  const language = new URL(request.url).searchParams.get("language") === "en" ? "en" : "pt";
  const criteria = toScriptCriteria(await listActiveCriteria(getDb()));
  if (criteria.length === 0) return new Response("no criterion is active", { status: 409 });

  return experimental_upgradeWebSocket((ws: WebSocket) => {
    void run(ws, criteria, language);
  });
}

async function run(ws: WebSocket, criteria: ScriptCriterion[], language: "pt" | "en") {
  const send = (payload: unknown) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  };

  let session: VoiceSession | null = null;

  try {
    session = await startVoiceSession({
      transport: geminiTransport(requireApiKey()),
      model: requireModelId("voice"),
      criteria,
      language,
      inputRate: CAPTURE_RATE,
      onEvent: (event) => {
        switch (event.type) {
          case "audio":
            // Binary frames are agent audio, at the model's output rate. The
            // client knows that rate; nothing else travels as binary.
            if (ws.readyState === ws.OPEN) ws.send(pcm16Bytes(event.pcm));
            break;
          case "transcript":
            send({ type: "transcript", turns: event.turns });
            break;
          case "interrupted":
            send({ type: "interrupted" });
            break;
          case "tool":
            send({ type: "tool", name: event.name, input: event.input });
            break;
          case "ended":
            // Logged as well as sent: when the provider kills a session the
            // browser is not always still there to show why.
            console.log("[harness] session ended", {
              stoppedBy: event.result.stoppedBy,
              seconds: event.result.durationSeconds,
              endedReason: event.result.endedReason,
              transportClose: event.result.transportClose,
              transportError: event.result.transportError,
            });
            send({
              type: "ended",
              endedReason: event.result.endedReason,
              outcome: event.result.outcome,
              cutOff: event.result.cutOff,
              stoppedBy: event.result.stoppedBy,
              transportClose: event.result.transportClose,
              transportError: event.result.transportError,
              durationSeconds: event.result.durationSeconds,
              liveAnswers: event.result.liveAnswers,
              // Said plainly on the page, so nobody mistakes a rehearsal for a
              // recorded attempt.
              persisted: false,
            });
            ws.close();
            break;
        }
      },
    });
    send({ type: "ready", language, criteria: criteria.map((c) => c.key) });
  } catch (error) {
    send({ type: "error", message: error instanceof Error ? error.message : String(error) });
    ws.close();
    return;
  }

  ws.on("message", (data: WebSocketData, isBinary?: boolean) => {
    if (isBinary || Buffer.isBuffer(data)) {
      session?.sendAudio(samplesFrom(Buffer.from(data as Buffer)));
      return;
    }
    try {
      const message = JSON.parse(String(data)) as ClientMessage;
      if (message.type === "stop") session?.stop("lead_declined");
    } catch {
      // A frame we cannot parse is not worth killing a live call over.
    }
  });

  ws.on("close", () => session?.stop("lead_declined"));
}

function samplesFrom(bytes: Buffer): Int16Array {
  const out = new Int16Array(bytes.length >> 1);
  for (let i = 0; i < out.length; i += 1) out[i] = bytes.readInt16LE(i * 2);
  return out;
}

function toScriptCriteria(rows: Awaited<ReturnType<typeof listActiveCriteria>>): ScriptCriterion[] {
  return rows.map((c) => ({
    key: c.key,
    label: c.label,
    questionPt: c.questionPt,
    questionEn: c.questionEn,
    type: c.type,
    options: c.options,
    expectedValue: c.expectedValue,
    weight: c.weight,
    blocking: c.blocking,
    active: c.active,
    sortOrder: c.sortOrder,
  }));
}
