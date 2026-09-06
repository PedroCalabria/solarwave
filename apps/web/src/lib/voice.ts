import "server-only";

import { findAttemptByCallSid, getAttemptById, getDb, type CallAttempt } from "@solarwave/db";
import { readVoiceConfig, validateTwilioSignature, verifyCallToken, type VoiceConfig } from "@solarwave/voice";

/**
 * Shared guards for the Twilio webhooks (voice-bridge design D10 and D13).
 *
 * These endpoints are publicly reachable in production — Vercel's deployment
 * protection covers the generated URLs but not the production domain, and
 * Twilio could not authenticate to it anyway. They close attempts, write
 * transcripts and trigger scoring, so the locks here are the only ones there
 * are.
 */

export type WebhookRequest = {
  config: VoiceConfig;
  params: Record<string, string>;
  attempt: CallAttempt;
};

export type WebhookRejection = { status: number; message: string };

/**
 * Verifies a webhook and resolves the attempt it belongs to.
 *
 * Two locks, one always present:
 *
 *   1. A signed token in the query string, bound to the attempt id and minted
 *      at dispatch. This is the primary lock, because Twilio's own signature is
 *      computed with the account AUTH TOKEN and this project authenticates with
 *      an API key, which cannot verify one (design D13).
 *   2. Twilio's `X-Twilio-Signature`, checked as well whenever
 *      `TWILIO_AUTH_TOKEN` happens to be configured. Optional, and strictly
 *      additional: it proves the request came from Twilio, which the token
 *      alone does not.
 */
export async function verifyTwilioWebhook(request: Request): Promise<
  { ok: true; value: WebhookRequest } | { ok: false; error: WebhookRejection }
> {
  const resolved = readVoiceConfig();
  if (!resolved.ok) {
    return { ok: false, error: { status: 503, message: "voice is not configured" } };
  }
  const config = resolved.config;

  const url = new URL(request.url);
  const token = url.searchParams.get("t");

  // The body is form-encoded and is read once, here, so the signature check and
  // the handler see the same parameters.
  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) params[key] = String(value);

  const attemptId = subjectOf(token);
  if (!attemptId) return { ok: false, error: { status: 403, message: "forbidden" } };

  const verified = verifyCallToken(token, attemptId, config.streamTokenSecret);
  if (!verified.ok) return { ok: false, error: { status: 403, message: "forbidden" } };

  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (authToken) {
    const signature = request.headers.get("x-twilio-signature") ?? "";
    // Twilio signs the URL exactly as it called it, query string included.
    if (!validateTwilioSignature(authToken, signature, url.toString(), params)) {
      return { ok: false, error: { status: 403, message: "forbidden" } };
    }
  }

  const attempt = await getAttemptById(getDb(), attemptId);
  if (!attempt) return { ok: false, error: { status: 404, message: "unknown attempt" } };

  return { ok: true, value: { config, params, attempt } };
}

/**
 * The attempt id a token claims, before the token is verified.
 *
 * Only used to tell `verifyCallToken` what to compare against, and the
 * signature check is what makes the claim trustworthy. Nothing is read from the
 * database on the strength of an unverified value.
 */
function subjectOf(token: string | null): string | null {
  if (!token) return null;
  const subject = token.split(".")[0];
  return subject && subject.length > 0 ? subject : null;
}


export { findAttemptByCallSid };
