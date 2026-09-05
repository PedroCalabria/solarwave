export {
  MODEL_ROLES,
  API_KEY_VAR,
  requireModelId,
  requireApiKey,
  hasApiKey,
  envVarFor,
  type ModelRole,
} from "./env";
export { createProvider, modelFor, resetProvider } from "./provider";
export {
  generateStructured,
  toAiError,
  isRetryable,
  needsOperatorAction,
  type AiError,
  type GenerateStructuredInput,
} from "./generate";
export {
  CATALOGUE_URL,
  fetchCatalogue,
  checkConfiguredModels,
  assertConfiguredModels,
  type CatalogueEntry,
  type ModelCheck,
  type Fetch,
} from "./catalogue";
export { fakeStructuredModel, failingModel, type FakeCall } from "./testing";
/** Re-exported so downstream packages never import the SDK directly. */
export type { LanguageModel } from "ai";
