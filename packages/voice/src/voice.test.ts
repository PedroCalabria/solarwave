import { describe, expect, it } from "vitest";
import { readVoiceConfig } from "./config";
import { isMachine, resolveAttemptOutcome } from "./outcome";
import { mintCallToken, verifyCallToken } from "./callToken";
import { connectStreamTwiml, hangUpTwiml } from "./twiml";

const FULL_ENV: NodeJS.ProcessEnv = {
  TWILIO_ACCOUNT_SID: "AC123",
  TWILIO_API_KEY_SID: "SK123",
  TWILIO_API_KEY_SECRET: "secret",
  TWILIO_FROM_NUMBER: "+15005550006",
  VOICE_PUBLIC_BASE_URL: "https://example.ngrok-free.dev",
  CALL_WORKER_SECRET: "worker-secret",
};

describe("configuration", () => {
  it("reads a complete environment", () => {
    const result = readVoiceConfig(FULL_ENV);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.twilio.accountSid).toBe("AC123");
    expect(result.config.maxCallSeconds).toBe(180);
    expect(result.config.wrapUpSeconds).toBe(90);
  });

  it("names everything that is missing, rather than the first thing", () => {
    const result = readVoiceConfig({ TWILIO_ACCOUNT_SID: "AC123" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toContain("TWILIO_API_KEY_SID");
    expect(result.missing).toContain("VOICE_PUBLIC_BASE_URL");
    expect(result.missing).not.toContain("TWILIO_ACCOUNT_SID");
  });

  it("treats a blank variable as missing", () => {
    const result = readVoiceConfig({ ...FULL_ENV, TWILIO_FROM_NUMBER: "   " });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toEqual(["TWILIO_FROM_NUMBER"]);
  });

  it("strips a trailing slash from the public base URL", () => {
    const result = readVoiceConfig({ ...FULL_ENV, VOICE_PUBLIC_BASE_URL: "https://example.dev///" });
    expect(result.ok && result.config.publicBaseUrl).toBe("https://example.dev");
  });

  it("keeps the wrap-up strictly inside the hard stop", () => {
    // A wrap-up at or after the stop never fires, which reads as an agent
    // ignoring its budget rather than as a misconfiguration.
    const result = readVoiceConfig({
      ...FULL_ENV,
      VOICE_WRAP_UP_SECONDS: "300",
      VOICE_MAX_CALL_SECONDS: "120",
    });
    expect(result.ok && result.config.wrapUpSeconds).toBe(119);
  });

  it("assumes a trial account until told otherwise", () => {
    // Guessing wrong the other way is a call that never happens: a trial
    // refuses the whole request over one premium parameter.
    const fallback = readVoiceConfig(FULL_ENV);
    expect(fallback.ok && fallback.config.trialAccount).toBe(true);
    const upgraded = readVoiceConfig({ ...FULL_ENV, TWILIO_TRIAL_ACCOUNT: "false" });
    expect(upgraded.ok && upgraded.config.trialAccount).toBe(false);
    const nonsense = readVoiceConfig({ ...FULL_ENV, TWILIO_TRIAL_ACCOUNT: "maybe" });
    expect(nonsense.ok && nonsense.config.trialAccount).toBe(true);
  });

  it("falls back on a nonsensical duration", () => {
    const result = readVoiceConfig({ ...FULL_ENV, VOICE_MAX_CALL_SECONDS: "not-a-number" });
    expect(result.ok && result.config.maxCallSeconds).toBe(180);
  });
});

describe("the call token", () => {
  const SECRET = "worker-secret";

  it("accepts a token minted for the same call", () => {
    const token = mintCallToken("CA123", SECRET);
    expect(verifyCallToken(token, "CA123", SECRET)).toEqual({ ok: true });
  });

  it("refuses a token minted for another call", () => {
    // The whole point: a valid token must not open a stream on someone else's
    // call and feed a transcript into the wrong lead.
    const token = mintCallToken("CA123", SECRET);
    expect(verifyCallToken(token, "CA999", SECRET)).toEqual({ ok: false, reason: "wrong_call" });
  });

  it("refuses a token signed with another secret", () => {
    const token = mintCallToken("CA123", "someone-elses-secret");
    expect(verifyCallToken(token, "CA123", SECRET)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a tampered expiry", () => {
    const token = mintCallToken("CA123", SECRET, 1000, 0);
    const [sid, , signature] = token.split(".");
    const forged = `${sid}.${9_999_999_999_999}.${signature}`;
    expect(verifyCallToken(forged, "CA123", SECRET)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("expires", () => {
    const token = mintCallToken("CA123", SECRET, 1000, 0);
    expect(verifyCallToken(token, "CA123", SECRET, 2000)).toEqual({ ok: false, reason: "expired" });
    expect(verifyCallToken(token, "CA123", SECRET, 500)).toEqual({ ok: true });
  });

  it("refuses a missing or malformed token", () => {
    expect(verifyCallToken(null, "CA123", SECRET)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyCallToken("", "CA123", SECRET)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyCallToken("nonsense", "CA123", SECRET)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyCallToken("a.b.c.d", "CA123", SECRET)).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("resolveAttemptOutcome", () => {
  it("maps the line's own failures", () => {
    expect(resolveAttemptOutcome({ status: "busy" })).toBe("busy");
    expect(resolveAttemptOutcome({ status: "no-answer" })).toBe("no_answer");
    expect(resolveAttemptOutcome({ status: "failed" })).toBe("failed");
    expect(resolveAttemptOutcome({ status: "canceled" })).toBe("failed");
  });

  it("treats every machine-detection verdict as voicemail", () => {
    for (const answeredBy of ["machine_start", "machine_end_beep", "machine_end_silence", "machine_end_other", "fax"]) {
      expect(resolveAttemptOutcome({ status: "completed", answeredBy })).toBe("voicemail");
      expect(isMachine(answeredBy)).toBe(true);
    }
  });

  it("lets a detected machine override whatever the session thought", () => {
    // Whatever conversation happened, it happened with an answering machine.
    expect(
      resolveAttemptOutcome({ status: "completed", answeredBy: "machine_start", sessionOutcome: "answered_complete" }),
    ).toBe("voicemail");
  });

  it("treats unknown detection as a human", () => {
    // Hanging up on a real person the detector was unsure about is the worse
    // error, and a call that produces nothing is already retryable.
    expect(resolveAttemptOutcome({ status: "completed", answeredBy: "unknown" })).toBe("answered_incomplete");
    expect(isMachine("unknown")).toBe(false);
    expect(isMachine(null)).toBe(false);
  });

  it("uses the session outcome for an answered human call", () => {
    for (const outcome of ["answered_complete", "answered_incomplete", "opt_out", "abusive", "minor_answered"] as const) {
      expect(resolveAttemptOutcome({ status: "completed", answeredBy: "human", sessionOutcome: outcome })).toBe(outcome);
    }
  });

  it("falls back to answered_incomplete when the bridge produced nothing", () => {
    expect(resolveAttemptOutcome({ status: "completed", answeredBy: "human" })).toBe("answered_incomplete");
    expect(resolveAttemptOutcome({ status: "completed", sessionOutcome: null })).toBe("answered_incomplete");
  });

  it("keeps a lead retryable on a status it does not know", () => {
    expect(resolveAttemptOutcome({ status: "ringing" })).toBe("failed");
  });
});

describe("TwiML", () => {
  it("connects a bidirectional stream carrying the token", () => {
    const xml = connectStreamTwiml({ publicBaseUrl: "https://example.dev", token: "CA1.123.sig" });
    expect(xml).toContain("<Connect>");
    expect(xml).toContain('<Stream url="wss://example.dev/api/media">');
    expect(xml).toContain('<Parameter name="token" value="CA1.123.sig" />');
    // Not <Start><Stream>: that one is one-way and the agent could not answer.
    expect(xml).not.toContain("<Start>");
  });

  it("uses ws for a plain-http origin", () => {
    const xml = connectStreamTwiml({ publicBaseUrl: "http://localhost:3999", token: "t" });
    expect(xml).toContain('url="ws://localhost:3999/api/media"');
  });

  it("escapes a token that would otherwise break the document", () => {
    const xml = connectStreamTwiml({ publicBaseUrl: "https://example.dev", token: 'a"&<b' });
    expect(xml).toContain("&quot;&amp;&lt;");
    expect(xml).not.toContain('value="a"&<b"');
  });

  it("hangs up in silence when a call cannot be served", () => {
    // The person who answered is a lead, not an operator: no spoken error.
    const xml = hangUpTwiml();
    expect(xml).toContain("<Hangup />");
    expect(xml).not.toContain("<Say");
  });
});
