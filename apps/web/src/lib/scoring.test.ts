import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAuthorisedWorkerCall } from "./scoring";

const request = (headers: Record<string, string> = {}) =>
  new Request("https://example.com/api/internal/score", { method: "POST", headers });

const original = process.env.SCORING_WORKER_SECRET;
afterEach(() => {
  process.env.SCORING_WORKER_SECRET = original;
});

describe("isAuthorisedWorkerCall", () => {
  beforeEach(() => {
    process.env.SCORING_WORKER_SECRET = "s3cret-value";
  });

  it("accepts the configured secret", () => {
    expect(isAuthorisedWorkerCall(request({ "x-scoring-secret": "s3cret-value" }))).toBe(true);
  });

  it("rejects a missing header", () => {
    expect(isAuthorisedWorkerCall(request())).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(isAuthorisedWorkerCall(request({ "x-scoring-secret": "guess" }))).toBe(false);
  });

  it("rejects an empty header even when the secret is empty", () => {
    process.env.SCORING_WORKER_SECRET = "";
    expect(isAuthorisedWorkerCall(request({ "x-scoring-secret": "" }))).toBe(false);
  });

  it("refuses every call when the secret is not configured at all", () => {
    // An unset secret must close the door, never open it.
    delete process.env.SCORING_WORKER_SECRET;
    expect(isAuthorisedWorkerCall(request({ "x-scoring-secret": "anything" }))).toBe(false);
    expect(isAuthorisedWorkerCall(request())).toBe(false);
  });
});

describe("POST /api/internal/score", () => {
  beforeEach(() => {
    process.env.SCORING_WORKER_SECRET = "s3cret-value";
  });

  it("responds 401 without touching the database or a model", async () => {
    const { POST } = await import("@/app/api/internal/score/route");
    const response = await POST(
      new Request("https://example.com/api/internal/score", {
        method: "POST",
        body: JSON.stringify({ attemptId: "22222222-2222-2222-2222-222222222222" }),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorised" });
  });

  it("rejects a body without an attempt id before doing any work", async () => {
    const { POST } = await import("@/app/api/internal/score/route");
    const response = await POST(
      new Request("https://example.com/api/internal/score", {
        method: "POST",
        headers: { "x-scoring-secret": "s3cret-value" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(400);
  });
});
