import { describe, expect, it } from "vitest";
import { assertConfiguredModels, checkConfiguredModels, type Fetch } from "./catalogue";
import { MODEL_ROLES, envVarFor, requireModelId } from "./env";

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

/**
 * Every role must be set or `requireModelId` throws, so the helper fills all of
 * them with a known-good id and takes overrides for the ones a test cares about.
 */
const env = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  GOOGLE_GENERATIVE_AI_API_KEY: "test-key",
  SCORING_MODEL_EXTRACTION: "gemini-3.8-flash",
  SCORING_MODEL_NARRATIVE: "gemini-3.5-flash-lite",
  SCORING_MODEL_JUDGE: "gemini-3.5-flash-lite",
  AGENT_MODEL_CONVERSATION: "gemini-3.5-flash-lite",
  AGENT_MODEL_PERSONA: "gemini-3.5-flash-lite",
  AGENT_MODEL_LINTER: "gemini-3.5-flash-lite",
  ...overrides,
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

  it("reads the agent roles from their own prefix, leaving the scoring names alone", () => {
    // Design D3: two prefixes rather than a rename, so no existing .env.local
    // or Vercel setting breaks when the agent roles arrive.
    expect(requireModelId("conversation", { AGENT_MODEL_CONVERSATION: "gemini-3.5-flash-lite" })).toBe(
      "gemini-3.5-flash-lite",
    );
    expect(requireModelId("persona", { AGENT_MODEL_PERSONA: "gemini-3.5-flash-lite" })).toBe("gemini-3.5-flash-lite");
    expect(requireModelId("linter", { AGENT_MODEL_LINTER: "gemini-3.5-flash-lite" })).toBe("gemini-3.5-flash-lite");
  });

  it("applies the gateway-slug guard to the agent roles too", () => {
    expect(() => requireModelId("conversation", { AGENT_MODEL_CONVERSATION: "google/gemini-3.5-flash-lite" })).toThrow(
      /drop the provider prefix.*gemini-3\.5-flash-lite/s,
    );
  });

  it("names the agent variable when it is missing", () => {
    expect(() => requireModelId("persona", {})).toThrow(/AGENT_MODEL_PERSONA is not set/);
  });

  it("maps every role to a distinct variable", () => {
    const names = MODEL_ROLES.map((role) => envVarFor(role));
    expect(new Set(names).size).toBe(MODEL_ROLES.length);
  });
});

describe("checkConfiguredModels", () => {
  it("marks every configured id available when the catalogue lists it", async () => {
    const checks = await checkConfiguredModels(
      env(), stubFetch());

    expect(checks).toHaveLength(MODEL_ROLES.length);
    expect(checks.every((c) => c.available)).toBe(true);
  });

  it("flags an id that has left the catalogue", async () => {
    const checks = await checkConfiguredModels(
      env({ SCORING_MODEL_EXTRACTION: "gemini-2.0-retired" }),
      stubFetch(),
    );

    expect(checks.find((c) => c.role === "extraction")?.available).toBe(false);
  });
});

describe("assertConfiguredModels", () => {
  it("passes silently when everything resolves", async () => {
    await expect(
      assertConfiguredModels(env(), stubFetch()),
    ).resolves.toBeUndefined();
  });

  it("names every misconfigured role in one message", async () => {
    const broken = env({ SCORING_MODEL_EXTRACTION: "gone-a", AGENT_MODEL_CONVERSATION: "gone-b" });
    const promise = assertConfiguredModels(broken, stubFetch());

    await expect(promise).rejects.toThrow(/SCORING_MODEL_EXTRACTION=gone-a/);
    await expect(assertConfiguredModels(broken, stubFetch())).rejects.toThrow(
      /AGENT_MODEL_CONVERSATION=gone-b/,
    );
  });

  it("requires the API key, unlike the gateway list which was public", async () => {
    await expect(
      assertConfiguredModels(
        { ...env(), GOOGLE_GENERATIVE_AI_API_KEY: "" },
        stubFetch(),
      ),
    ).rejects.toThrow(/GOOGLE_GENERATIVE_AI_API_KEY is not set/);
  });

  it("surfaces a catalogue outage rather than silently passing", async () => {
    await expect(
      assertConfiguredModels(env(), stubFetch({}, 503)),
    ).rejects.toThrow(/HTTP 503/);
  });
});
