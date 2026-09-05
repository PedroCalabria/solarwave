import { MODEL_ROLES, envVarFor, requireApiKey, requireModelId, type ModelRole } from "./env";

/**
 * Google's model list. Unlike the AI Gateway's catalogue this one needs the API
 * key, so the startup check cannot run before a key is provisioned.
 */
export const CATALOGUE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export type CatalogueEntry = {
  /** Google returns `models/gemini-3.8-flash`; `id` is the bare id. */
  id: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
};

type CatalogueResponse = {
  models?: { name?: string; displayName?: string; supportedGenerationMethods?: string[] }[];
};

export type Fetch = typeof globalThis.fetch;

export async function fetchCatalogue(
  fetchImpl: Fetch = globalThis.fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CatalogueEntry[]> {
  const response = await fetchImpl(`${CATALOGUE_URL}?pageSize=200`, {
    headers: { "x-goog-api-key": requireApiKey(env) },
  });
  if (!response.ok) throw new Error(`model catalogue returned HTTP ${response.status}`);

  const body = (await response.json()) as CatalogueResponse;
  return (body.models ?? []).map((m) => ({
    id: (m.name ?? "").replace(/^models\//, ""),
    displayName: m.displayName,
    supportedGenerationMethods: m.supportedGenerationMethods,
  }));
}

export type ModelCheck = { role: ModelRole; envVar: string; modelId: string; available: boolean };

/**
 * Checks the configured model ids against the live catalogue. Gemini ids move
 * fast — `gemini-3.8-flash` was two days old when it was chosen — so a stale id
 * must surface as a clear startup message rather than a 400 mid-call.
 */
export async function checkConfiguredModels(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: Fetch = globalThis.fetch,
): Promise<ModelCheck[]> {
  const catalogue = await fetchCatalogue(fetchImpl, env);
  const ids = new Set(catalogue.map((m) => m.id));

  return MODEL_ROLES.map((role) => {
    const modelId = requireModelId(role, env);
    return { role, envVar: envVarFor(role), modelId, available: ids.has(modelId) };
  });
}

/** Throws listing every misconfigured role at once, rather than one per run. */
export async function assertConfiguredModels(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: Fetch = globalThis.fetch,
): Promise<void> {
  const checks = await checkConfiguredModels(env, fetchImpl);
  const missing = checks.filter((c) => !c.available);
  if (missing.length === 0) return;

  const lines = missing.map((c) => `  ${c.envVar}=${c.modelId} is not in the catalogue`);
  throw new Error(
    `Configured model ids are not available from Google:\n${lines.join("\n")}\n` +
      `List the current ids with:\n` +
      `  curl -H "x-goog-api-key: $GOOGLE_GENERATIVE_AI_API_KEY" "${CATALOGUE_URL}?pageSize=200"`,
  );
}
