import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A short-lived token binding a request to one subject (design D10, D13).
 *
 * Used twice, for two things Twilio's own signature cannot cover:
 *
 *   - the media socket, bound to the CALL SID. Twilio signs its webhooks but
 *     not the WebSocket upgrade for a Media Stream, so `/api/media` has no
 *     signature to check. Without this it is an open socket that anyone who
 *     guesses the URL can start a Gemini session on, at our expense, and feed
 *     a transcript into somebody's lead.
 *   - the webhook URLs, bound to the ATTEMPT ID. Twilio computes its signature
 *     with the account AUTH TOKEN, and this project authenticates with an API
 *     key, which cannot verify one. Since we build those URLs ourselves at
 *     dispatch, they carry a token instead, and signature validation is layered
 *     on top whenever an auth token is also configured (design D13).
 */

const SEPARATOR = ".";

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** `<subject>.<expiryMs>.<signature>`, URL-safe so it can be a query parameter. */
export function mintCallToken(subject: string, secret: string, ttlMs = 10 * 60 * 1000, now = Date.now()): string {
  const payload = `${subject}${SEPARATOR}${now + ttlMs}`;
  return `${payload}${SEPARATOR}${sign(payload, secret)}`;
}

export type CallTokenFailure = "malformed" | "bad_signature" | "expired" | "wrong_call";

export function verifyCallToken(
  token: string | null | undefined,
  expectedSubject: string,
  secret: string,
  now = Date.now(),
): { ok: true } | { ok: false; reason: CallTokenFailure } {
  if (!token) return { ok: false, reason: "malformed" };

  const parts = token.split(SEPARATOR);
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [subject, expiry, signature] = parts as [string, string, string];

  const expiresAt = Number(expiry);
  if (!Number.isFinite(expiresAt)) return { ok: false, reason: "malformed" };

  // Signature before anything else: an unsigned token's fields are attacker
  // input and must not be trusted enough to produce a specific error.
  const expected = sign(`${subject}${SEPARATOR}${expiry}`, secret);
  if (!equals(signature, expected)) return { ok: false, reason: "bad_signature" };

  if (now > expiresAt) return { ok: false, reason: "expired" };
  if (subject !== expectedSubject) return { ok: false, reason: "wrong_call" };
  return { ok: true };
}

/** Constant time, and length-safe: `timingSafeEqual` throws on a length mismatch. */
function equals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Twilio's own request signature, when an account auth token is available.
 *
 * Strictly additional to the call token above (design D13). The token proves
 * the caller knows a secret we handed Twilio; this proves the request actually
 * came from Twilio. An API key cannot compute it — Twilio signs with the
 * account AUTH TOKEN — so it is checked only when one is configured.
 */
export function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  // Imported lazily so the barrel stays importable where telephony is not set
  // up, and so a browser bundle never pulls the SDK in through this module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const twilio = require("twilio") as typeof import("twilio");
  return twilio.validateRequest(authToken, signature, url, params);
}
