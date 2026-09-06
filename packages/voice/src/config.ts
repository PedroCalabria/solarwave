/**
 * Everything the telephony half reads from the environment, in one place.
 *
 * Read rather than imported: `packages/voice` must stay usable from a Fastify
 * host on Fly.io if the WebSocket beta ever bites (design D2), and a package
 * that reaches into `process.env` at module scope is a package that only works
 * where someone remembered to set it up first.
 */

export type TwilioConfig = {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  fromNumber: string;
};

export type VoiceConfig = {
  twilio: TwilioConfig;
  /** Origin Twilio reaches, no trailing slash. A tunnel locally, production otherwise. */
  publicBaseUrl: string;
  /** Signs the media-stream token. Reuses the dispatch secret. */
  streamTokenSecret: string;
  wrapUpSeconds: number;
  maxCallSeconds: number;
  /**
   * Whether the Twilio account is a trial.
   *
   * A trial rejects the WHOLE call request when it carries a parameter it is
   * not entitled to, so this is one switch over a set rather than a knob per
   * parameter. MEASURED 2026-09-06 by probing the API with an unverified
   * destination, which is refused either way and places nothing:
   *
   *   To / From / Url          accepted
   *   StatusCallback           accepted
   *   StatusCallbackEvent      accepted
   *   StatusCallbackMethod     REFUSED   (POST is the default, so no loss)
   *   TimeLimit                REFUSED
   *   MachineDetection         REFUSED
   *   AsyncAmd                 REFUSED
   *
   * Defaults to true, because that is what this project runs on and the cost
   * of guessing wrong is a call that never happens. Set
   * `TWILIO_TRIAL_ACCOUNT=false` after upgrading; nothing else changes, since
   * the outcome mapping already reads `AnsweredBy` whenever Twilio sends it.
   *
   * What a trial call gives up, stated rather than hidden:
   *   - No answering-machine detection. A machine is treated as a human, the
   *     conversation produces nothing usable, and the attempt ends
   *     `answered_incomplete` - the same path a failed bridge takes, which the
   *     retry policy already handles.
   *   - No provider-side duration limit. Our own hard stop is the only budget,
   *     and the call still ends when the media socket closes.
   */
  trialAccount: boolean;
};

export const DEFAULT_WRAP_UP_SECONDS = 90;
export const DEFAULT_MAX_CALL_SECONDS = 180;

function trimmed(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * The voice configuration, or the list of what is missing.
 *
 * Returns rather than throws: a portal that renders "Twilio is not configured"
 * is more useful than one that 500s, and the dispatch path turns this into a
 * `not_configured` refusal the operator can read.
 */
export function readVoiceConfig(env: NodeJS.ProcessEnv = process.env):
  | { ok: true; config: VoiceConfig }
  | { ok: false; missing: string[] } {
  const required = {
    accountSid: "TWILIO_ACCOUNT_SID",
    apiKeySid: "TWILIO_API_KEY_SID",
    apiKeySecret: "TWILIO_API_KEY_SECRET",
    fromNumber: "TWILIO_FROM_NUMBER",
    publicBaseUrl: "VOICE_PUBLIC_BASE_URL",
    streamTokenSecret: "CALL_WORKER_SECRET",
  } as const;

  const missing = Object.values(required).filter((name) => trimmed(env, name) === undefined);
  if (missing.length > 0) return { ok: false, missing };

  const maxCallSeconds = positiveInt(trimmed(env, "VOICE_MAX_CALL_SECONDS"), DEFAULT_MAX_CALL_SECONDS);
  const wrapUpSeconds = positiveInt(trimmed(env, "VOICE_WRAP_UP_SECONDS"), DEFAULT_WRAP_UP_SECONDS);

  return {
    ok: true,
    config: {
      twilio: {
        accountSid: trimmed(env, required.accountSid)!,
        apiKeySid: trimmed(env, required.apiKeySid)!,
        apiKeySecret: trimmed(env, required.apiKeySecret)!,
        fromNumber: trimmed(env, required.fromNumber)!,
      },
      publicBaseUrl: trimmed(env, required.publicBaseUrl)!.replace(/\/+$/, ""),
      streamTokenSecret: trimmed(env, required.streamTokenSecret)!,
      // A wrap-up at or after the hard stop would never fire, which would look
      // like the agent ignoring its budget rather than a misconfiguration.
      wrapUpSeconds: Math.min(wrapUpSeconds, maxCallSeconds - 1),
      maxCallSeconds,
      trialAccount: trimmed(env, "TWILIO_TRIAL_ACCOUNT")?.toLowerCase() !== "false",
    },
  };
}

/** Whether telephony is configured at all, for a portal that must not 500. */
export function hasVoiceConfig(env: NodeJS.ProcessEnv = process.env): boolean {
  return readVoiceConfig(env).ok;
}
