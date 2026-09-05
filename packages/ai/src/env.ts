/**
 * Model ids are never hardcoded: the Gemini catalogue moves fast and the ids
 * are read from Google's model list (design D12). Each call role gets its own
 * variable so the eval can compare models without touching code.
 */
export const MODEL_ROLES = ["extraction", "narrative", "judge"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

const ENV_VAR: Record<ModelRole, string> = {
  extraction: "SCORING_MODEL_EXTRACTION",
  narrative: "SCORING_MODEL_NARRATIVE",
  judge: "SCORING_MODEL_JUDGE",
};

/** The variable `@ai-sdk/google` reads by default, sent as `x-goog-api-key`. */
export const API_KEY_VAR = "GOOGLE_GENERATIVE_AI_API_KEY";

/** Fails fast and loudly: a missing model id must not surface as a runtime 400. */
export function requireModelId(role: ModelRole, env: NodeJS.ProcessEnv = process.env): string {
  const name = ENV_VAR[role];
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is not set. Pick an id from Google's model list ` +
        `(https://generativelanguage.googleapis.com/v1beta/models) and add it to apps/web/.env.local. ` +
        `Ids are plain, with no provider prefix: "gemini-3.8-flash", not "google/gemini-3.8-flash".`,
    );
  }
  if (value.includes("/")) {
    throw new Error(
      `${name}="${value}" looks like an AI Gateway slug. This project calls Google directly, so drop ` +
        `the provider prefix: use "${value.split("/").pop()}".`,
    );
  }
  return value;
}

export function envVarFor(role: ModelRole): string {
  return ENV_VAR[role];
}

export function requireApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env[API_KEY_VAR]?.trim();
  if (!key) {
    throw new Error(
      `${API_KEY_VAR} is not set. Create a free key at https://aistudio.google.com/apikey ` +
        `and add it to apps/web/.env.local.`,
    );
  }
  return key;
}

export function hasApiKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env[API_KEY_VAR]?.trim());
}
