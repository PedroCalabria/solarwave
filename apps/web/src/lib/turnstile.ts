const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileVerifier = (token: string, remoteIp: string | null) => Promise<boolean>;

/**
 * Server-side verification of a Cloudflare Turnstile token. With Cloudflare's
 * published test secret every dummy token from the test site key validates,
 * which keeps local runs deterministic.
 */
export const verifyTurnstileToken: TurnstileVerifier = async (token, remoteIp) => {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) throw new Error("TURNSTILE_SECRET_KEY is not set");

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  const res = await fetch(SITEVERIFY_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { success?: boolean };
  return data.success === true;
};
