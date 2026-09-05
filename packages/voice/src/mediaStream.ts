/**
 * The Twilio Media Streams protocol, as data (voice-bridge task 10.2).
 *
 * Pulled out of the route because the route is the one place none of this can
 * be tested: it needs an upgraded socket, a live model and a telephone. Frame
 * parsing and frame building are neither, and they are where a silent
 * mistake — a missing `streamSid`, a `clear` that never reaches Twilio — turns
 * into an agent nobody can hear or interrupt on a real call.
 */

export type TwilioStart = {
  callSid: string;
  streamSid: string;
  /** From the `<Parameter>` in the TwiML. The media socket's only lock. */
  token: string | null;
};

export type TwilioFrame =
  | { event: "connected" }
  | { event: "start"; start: TwilioStart }
  | { event: "media"; streamSid: string | null; payload: string }
  | { event: "stop"; streamSid: string | null }
  | { event: "mark"; streamSid: string | null }
  /** Anything we do not act on, kept rather than thrown so callers can log it. */
  | { event: "unknown"; raw: string };

type RawFrame = {
  event?: unknown;
  streamSid?: unknown;
  start?: { callSid?: unknown; streamSid?: unknown; customParameters?: Record<string, unknown> };
  media?: { payload?: unknown };
};

const str = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

/**
 * One inbound frame, or null when it is not JSON at all.
 *
 * A frame missing what its event needs comes back as `unknown` rather than a
 * half-built object: a `start` with no call SID cannot be authenticated, and
 * pretending otherwise would open a session on an unverifiable stream.
 */
export function parseTwilioFrame(raw: string): TwilioFrame | null {
  let parsed: RawFrame;
  try {
    parsed = JSON.parse(raw) as RawFrame;
  } catch {
    return null;
  }

  const event = str(parsed.event);
  const streamSid = str(parsed.streamSid);

  switch (event) {
    case "connected":
      return { event: "connected" };

    case "start": {
      const callSid = str(parsed.start?.callSid);
      const startStreamSid = str(parsed.start?.streamSid) ?? streamSid;
      if (!callSid || !startStreamSid) return { event: "unknown", raw };
      return {
        event: "start",
        start: { callSid, streamSid: startStreamSid, token: str(parsed.start?.customParameters?.token) },
      };
    }

    case "media": {
      const payload = str(parsed.media?.payload);
      if (!payload) return { event: "unknown", raw };
      return { event: "media", streamSid, payload };
    }

    case "stop":
      return { event: "stop", streamSid };

    case "mark":
      return { event: "mark", streamSid };

    default:
      return { event: "unknown", raw };
  }
}

/** Agent audio back down the same socket: base64 mu-law at 8 kHz. */
export function mediaFrame(streamSid: string, payloadBase64: string): string {
  return JSON.stringify({ event: "media", streamSid, media: { payload: payloadBase64 } });
}

/**
 * Discards audio Twilio has buffered but not yet played.
 *
 * Sent on barge-in. Without it the agent keeps talking over the lead for as
 * long as the buffer lasts, which on a phone is the difference between being
 * interrupted and being ignored.
 */
export function clearFrame(streamSid: string): string {
  return JSON.stringify({ event: "clear", streamSid });
}
