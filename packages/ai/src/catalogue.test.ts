import { describe, expect, it } from "vitest";
import { assertConfiguredModels, checkConfiguredModels, type Fetch } from "./catalogue";
import { requireModelId } from "./env";

/** Google returns `models/<id>` and needs the key; the Gateway's list did neither. */
const CATALOGUE = {
  models: [
    { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-3.5-flash-lite", supportedGenerationMethods: ["generateContent"] },
  ],
};

const stubFetch = (body: unknown = CATALOGUE, status = 200): Fetch =>
  (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as Response) as Fetch;

const env = (extraction: string, narrative: string, judge: string): NodeJS.ProcessEnv => ({
  GOOGLE_GENERATIVE_AI_API_KEY: "test-key",
  SCORING_MODEL_EXTRACTION: extraction,
  SCORING_MODEL_NARRATIVE: narrative,
  SCORING_MODEL_JUDGE: judge,
});

describe("requireModelId", () => {
  it("rejects a leftover AI Gateway slug with a message that says how to fix it", () => {
    // Anyone copying the old value forward gets told exactly what to change,
    // rather than a 404 from Google halfway through a call.
    expect(() => requireModelId("extraction", { SCORING_MODEL_EXTRACTION: "google/gemini-3.8-flash" })).toThrow(
      /drop the provider prefix.*gemini-3\.8-flash/s,
    );
  });

  it("fails with an actionable message when the variable is missing", () => {
    expect(() => requireModelId("extraction", {})).toThrow(/SCORING_MODEL_EXTRACTION is not set/);
    expect(() => requireModelId("extraction", {})).toThrow(/generativelanguage\.googleapis\.com/);
  });

  it("rejects a variable that is only whitespace", () => {
    expect(() => requireModelId("judge", { SCORING_MODEL_JUDGE: "   " })).toThrow();
  });
});

describe("checkConfiguredModels", () => {
  it("marks every configured id available when the catalogue lists it", async () => {
    const checks = await checkConfiguredModels(
      env("gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.5-flash-lite"),
      stubFetch(),
    );

    expect(checks).toHaveLength(3);
    expect(checks.every((c) => c.available)).toBe(true);
  });

  it("flags an id that has left the catalogue", async () => {
    const checks = await checkConfiguredModels(
      env("gemini-2.0-retired", "gemini-3.5-flash-lite", "gemini-3.5-flash-lite"),
      stubFetch(),
    );

    expect(checks.find((c) => c.role === "extraction")?.available).toBe(false);
  });
});

describe("assertConfiguredModels", () => {
  it("passes silently when everything resolves", async () => {
    await expect(
      assertConfiguredModels(
        env("gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.5-flash-lite"),
        stubFetch(),
      ),
    ).resolves.toBeUndefined();
  });

  it("names every misconfigured role in one message", async () => {
    const promise = assertConfiguredModels(
      env("gone-a", "gone-b", "gemini-3.5-flash-lite"),
      stubFetch(),
    );

    await expect(promise).rejects.toThrow(/SCORING_MODEL_EXTRACTION=gone-a/);
    await expect(
      assertConfiguredModels(env("gone-a", "gone-b", "gemini-3.5-flash-lite"), stubFetch()),
    ).rejects.toThrow(/SCORING_MODEL_NARRATIVE=gone-b/);
  });

  it("requires the API key, unlike the gateway list which was public", async () => {
    await expect(
      assertConfiguredModels(
        { SCORING_MODEL_EXTRACTION: "gemini-3.8-flash", SCORING_MODEL_NARRATIVE: "x", SCORING_MODEL_JUDGE: "y" },
        stubFetch(),
      ),
    ).rejects.toThrow(/GOOGLE_GENERATIVE_AI_API_KEY is not set/);
  });

  it("surfaces a catalogue outage rather than silently passing", async () => {
    await expect(
      assertConfiguredModels(
        env("gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.5-flash-lite"),
        stubFetch({}, 503),
      ),
    ).rejects.toThrow(/HTTP 503/);
  });
});
