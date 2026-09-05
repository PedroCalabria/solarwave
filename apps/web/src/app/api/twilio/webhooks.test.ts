import { mintCallToken } from "@solarwave/voice";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The webhooks are the only publicly reachable endpoints that close attempts,
 * write transcripts and trigger scoring (voice-bridge task 10.6, design D13).
 *
 * These drive the real handler with a stubbed database and telephony config, so
 * a rejection is proven by the absence of a call rather than by reading code.
 */

const SECRET = "worker-secret";
const ATTEMPT_ID = "11111111-1111-1111-1111-111111111111";

const ENV = {
  TWILIO_ACCOUNT_SID: "AC1",
  TWILIO_API_KEY_SID: "SK1",
  TWILIO_API_KEY_SECRET: "s",
  TWILIO_FROM_NUMBER: "+15005550006",
  VOICE_PUBLIC_BASE_URL: "https://example.dev",
  CALL_WORKER_SECRET: SECRET,
};

const attempt = {
  id: ATTEMPT_ID,
  leadId: "22222222-2222-2222-2222-222222222222",
  attemptNumber: 1,
  endedAt: null,
  outcome: null,
  endedReason: null,
  transcript: null,
};

const getAttemptById = vi.fn();
const finishAttempt = vi.fn();
const getLeadById = vi.fn();
const scoreAttempt = vi.fn();

vi.mock("@solarwave/db", () => ({
  getDb: () => ({}),
  getAttemptById: (...args: unknown[]) => getAttemptById(...args),
  findAttemptByCallSid: vi.fn(),
  finishAttempt: (...args: unknown[]) => finishAttempt(...args),
  getLeadById: (...args: unknown[]) => getLeadById(...args),
}));
vi.mock("@solarwave/scoring", () => ({ scoreAttempt: (...args: unknown[]) => scoreAttempt(...args) }));
vi.mock("@/lib/scoring", () => ({ scoringDeps: () => ({}) }));

function form(params: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(params)) data.append(k, v);
  return data;
}

function post(url: string, params: Record<string, string>): Request {
  return new Request(url, { method: "POST", body: form(params) });
}

beforeEach(() => {
  vi.stubEnv("TWILIO_AUTH_TOKEN", "");
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  getAttemptById.mockReset().mockResolvedValue(attempt);
  finishAttempt.mockReset().mockResolvedValue({ ok: true, attempt, lead: {}, alreadyClosed: false });
  getLeadById.mockReset().mockResolvedValue({ id: attempt.leadId, timezone: "America/Sao_Paulo" });
  scoreAttempt.mockReset().mockResolvedValue({ status: "done" });
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/twilio/status", () => {
  const url = (token?: string) =>
    `https://example.dev/api/twilio/status${token === undefined ? "" : `?t=${token}`}`;

  it("closes nothing when the token is missing", async () => {
    const { POST } = await import("./status/route");
    const response = await POST(post(url(), { CallStatus: "completed", CallSid: "CA1" }));

    expect(response.status).toBe(403);
    expect(finishAttempt).not.toHaveBeenCalled();
    expect(scoreAttempt).not.toHaveBeenCalled();
  });

  it("closes nothing when the token is signed with another secret", async () => {
    const { POST } = await import("./status/route");
    const forged = mintCallToken(ATTEMPT_ID, "not-the-secret");
    const response = await POST(post(url(forged), { CallStatus: "completed", CallSid: "CA1" }));

    expect(response.status).toBe(403);
    expect(finishAttempt).not.toHaveBeenCalled();
  });

  it("closes nothing when the token has expired", async () => {
    const { POST } = await import("./status/route");
    const stale = mintCallToken(ATTEMPT_ID, SECRET, 1000, Date.now() - 60_000);
    const response = await POST(post(url(stale), { CallStatus: "completed", CallSid: "CA1" }));

    expect(response.status).toBe(403);
    expect(finishAttempt).not.toHaveBeenCalled();
  });

  it("closes the attempt for a valid token", async () => {
    const { POST } = await import("./status/route");
    const token = mintCallToken(ATTEMPT_ID, SECRET);
    const response = await POST(post(url(token), { CallStatus: "completed", CallSid: "CA1" }));

    expect(response.status).toBe(200);
    expect(finishAttempt).toHaveBeenCalledOnce();
  });

  it("ignores a non-terminal status without closing anything", async () => {
    // Asynchronous machine detection posts here before the call completes.
    const { POST } = await import("./status/route");
    const token = mintCallToken(ATTEMPT_ID, SECRET);
    const response = await POST(post(url(token), { CallStatus: "ringing", CallSid: "CA1" }));

    expect(response.status).toBe(200);
    expect(finishAttempt).not.toHaveBeenCalled();
  });

  it("does not score a call that produced no transcript", async () => {
    const { POST } = await import("./status/route");
    const token = mintCallToken(ATTEMPT_ID, SECRET);
    await POST(post(url(token), { CallStatus: "no-answer", CallSid: "CA1" }));

    expect(finishAttempt).toHaveBeenCalledOnce();
    expect(scoreAttempt).not.toHaveBeenCalled();
  });

  it("scores once, not twice, when Twilio retries", async () => {
    const { POST } = await import("./status/route");
    finishAttempt.mockResolvedValueOnce({
      ok: true,
      attempt: { ...attempt, transcript: [{ who: "ai", text: "olá" }] },
      lead: {},
      alreadyClosed: false,
    });
    finishAttempt.mockResolvedValueOnce({ ok: true, attempt, lead: {}, alreadyClosed: true });

    const token = mintCallToken(ATTEMPT_ID, SECRET);
    await POST(post(url(token), { CallStatus: "completed", CallSid: "CA1" }));
    await POST(post(url(token), { CallStatus: "completed", CallSid: "CA1" }));

    expect(scoreAttempt).toHaveBeenCalledOnce();
  });
});

describe("POST /api/twilio/voice", () => {
  it("hangs up in silence when the token is invalid", async () => {
    const { POST } = await import("./voice/route");
    const response = await POST(post("https://example.dev/api/twilio/voice?t=nonsense", { CallSid: "CA1" }));

    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body).toContain("<Hangup />");
    // Nothing that would let a stranger open a media socket.
    expect(body).not.toContain("<Stream");
  });

  it("returns a stream carrying a token bound to the call", async () => {
    const { POST } = await import("./voice/route");
    const token = mintCallToken(ATTEMPT_ID, SECRET);
    const response = await POST(
      post(`https://example.dev/api/twilio/voice?t=${token}`, { CallSid: "CA_REAL" }),
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('<Stream url="wss://example.dev/api/media">');
    expect(body).toMatch(/<Parameter name="token" value="CA_REAL\..+\..+" \/>/);
  });
});
