import { experimental_upgradeWebSocket, type WebSocket, type WebSocketData } from "@vercel/functions";
import { requireApiKey, requireModelId } from "@solarwave/ai";
import type { ScriptCriterion } from "@solarwave/agent/criteria";
import {
  findAttemptByCallSid,
  getDb,
  getLeadById,
  listActiveCriteria,
  persistLiveTranscript,
  recordSessionResult,
} from "@solarwave/db";
import {
  CallAudio,
  clearFrame,
  geminiTransport,
  mediaFrame,
  parseTwilioFrame,
  readVoiceConfig,
  startVoiceSession,
  verifyCallToken,
  type TwilioStart,
  type VoiceSession,
} from "@solarwave/voice";

/**
 * Twilio Media Streams to Gemini Live, and back (voice-bridge task 10.2).
 *
 * Best-effort by design. This socket dies with its function instance, at the
 * duration limit, on a redeploy, or on any uncaught error, so it never decides
 * how an attempt ended — it publishes what it knows and the status callback
 * writes the ending (design D4).
 *
 * `next dev` does not perform the upgrade. Use `pnpm dev:voice`.
 */

/** Throttles the mid-call transcript write. One row, last write wins. */
const TRANSCRIPT_WRITE_MS = 3000;

export async function GET() {
  return experimental_upgradeWebSocket((ws: WebSocket) => {
    void bridge(ws);
  });
}

async function bridge(ws: WebSocket) {
  const resolved = readVoiceConfig();
  if (!resolved.ok) return ws.close();
  const config = resolved.config;

  const audio = new CallAudio();
  let session: VoiceSession | null = null;
  let streamSid: string | null = null;
  let attemptId: string | null = null;
  let lastWrite = 0;
  let pending: Parameters<typeof persistLiveTranscript>[2] | null = null;

  /** Drops audio Twilio has buffered but not yet played (design D8). */
  const clearPlayback = () => {
    if (streamSid && ws.readyState === ws.OPEN) ws.send(clearFrame(streamSid));
  };

  const writeTranscript = async (turns: NonNullable<typeof pending>, force = false) => {
    if (!attemptId) return;
    const now = Date.now();
    if (!force && now - lastWrite < TRANSCRIPT_WRITE_MS) {
      pending = turns;
      return;
    }
    lastWrite = now;
    pending = null;
    await persistLiveTranscript(getDb(), attemptId, turns);
  };

  const start = async ({ callSid, streamSid: sid, token }: TwilioStart) => {
    streamSid = sid;

    // Twilio does not sign the upgrade, so this token is the only lock. Checked
    // before a model session is opened, so a forged stream costs nothing.
    if (!verifyCallToken(token, callSid, config.streamTokenSecret).ok) return ws.close();

    const db = getDb();
    const attempt = await findAttemptByCallSid(db, callSid);
    if (!attempt || attempt.endedAt) return ws.close();
    attemptId = attempt.id;

    const lead = await getLeadById(db, attempt.leadId);
    if (!lead) return ws.close();

    const criteria = toScriptCriteria(await listActiveCriteria(db));
    if (criteria.length === 0) return ws.close();

    session = await startVoiceSession({
      transport: geminiTransport(requireApiKey()),
      model: requireModelId("voice"),
      criteria,
      language: lead.preferredCallLanguage,
      leadName: lead.name,
      wrapUpSeconds: config.wrapUpSeconds,
      maxCallSeconds: config.maxCallSeconds,
      inputRate: audio.formats.modelInputRate,
      onEvent: (event) => {
        switch (event.type) {
          case "audio":
            if (streamSid && ws.readyState === ws.OPEN) {
              ws.send(mediaFrame(streamSid, audio.fromModel(base64Of(event.pcm))));
            }
            break;
          case "interrupted":
            clearPlayback();
            break;
          case "transcript":
            void writeTranscript(event.turns);
            break;
          case "ended":
            // Published, not decided: `ended_at` stays null so the status
            // callback is still the one that closes the attempt (design D4).
            void (async () => {
              if (!attemptId) return;
              await recordSessionResult(getDb(), attemptId, {
                outcome: event.result.outcome,
                endedReason: event.result.endedReason,
                transcript: event.result.transcript,
              });
              ws.close();
            })();
            break;
          case "tool":
            break;
        }
      },
    });
  };

  ws.on("message", (data: WebSocketData) => {
    const frame = parseTwilioFrame(String(data));
    if (!frame) return;

    switch (frame.event) {
      case "start":
        void start(frame.start).catch(() => ws.close());
        break;
      case "media":
        if (session) session.sendAudio(audio.fromTelephony(frame.payload));
        break;
      case "stop":
        session?.stop();
        break;
      default:
        break;
    }
  });

  ws.on("close", () => {
    // Flush whatever the throttle was holding: a conversation is worth one
    // extra write, and this is the last chance to keep it.
    if (pending) void writeTranscript(pending, true);
    session?.stop();
  });
}

/** Model PCM is base64'd once here rather than in the converter. */
function base64Of(pcm: Int16Array): string {
  const bytes = Buffer.allocUnsafe(pcm.length * 2);
  for (let i = 0; i < pcm.length; i += 1) bytes.writeInt16LE(pcm[i]!, i * 2);
  return bytes.toString("base64");
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
