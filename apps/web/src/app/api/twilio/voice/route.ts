import { mintCallToken, connectStreamTwiml, hangUpTwiml } from "@solarwave/voice";
import { verifyTwilioWebhook } from "@/lib/voice";

/**
 * The instructions Twilio fetches when the callee picks up.
 *
 * Returns a bidirectional `<Connect><Stream>` pointed at `/api/media`, carrying
 * a token bound to THIS call's SID. Twilio does not sign the WebSocket upgrade,
 * so that token is the media socket's only lock (design D10).
 */
export async function POST(request: Request) {
  const verified = await verifyTwilioWebhook(request);
  if (!verified.ok) {
    // A caller who reached us without a valid token hears nothing at all.
    return xml(hangUpTwiml(), verified.error.status);
  }

  const { config, params } = verified.value;
  const callSid = params.CallSid;
  if (!callSid) return xml(hangUpTwiml(), 400);

  const token = mintCallToken(callSid, config.streamTokenSecret);
  return xml(connectStreamTwiml({ publicBaseUrl: config.publicBaseUrl, token }), 200);
}

function xml(body: string, status: number): Response {
  return new Response(body, { status, headers: { "content-type": "text/xml; charset=utf-8" } });
}
