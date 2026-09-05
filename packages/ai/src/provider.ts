import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { requireApiKey, requireModelId, type ModelRole } from "./env";

/**
 * Calls Google directly rather than through the Vercel AI Gateway.
 *
 * The Gateway was the original design, but it refuses every request until a
 * payment method is on file, free credits included, which the Hobby-plan,
 * demo-only premise of this project rules out (design D12). Google AI Studio
 * issues a free key with no card.
 *
 * The trade this makes is real and is recorded in D12: the Gateway reported
 * `no_training: all` for these models, and calling Google directly puts the
 * free-tier terms back in force, where content may be used to improve their
 * products. That is acceptable only because this system never handles real
 * customer data.
 */
export function createProvider(env: NodeJS.ProcessEnv = process.env) {
  return createGoogleGenerativeAI({ apiKey: requireApiKey(env) });
}

let cached: ReturnType<typeof createProvider> | null = null;

function provider(env: NodeJS.ProcessEnv = process.env) {
  if (!cached) cached = createProvider(env);
  return cached;
}

/**
 * Resolves a call role to a model. Everything downstream takes a
 * `LanguageModel`, so swapping the provider changes nothing but this file.
 */
export function modelFor(role: ModelRole, env: NodeJS.ProcessEnv = process.env): LanguageModel {
  // The provider is memoised on the key, but the model id is read per call, so
  // an eval can measure a different model without touching .env.local.
  return provider(env)(requireModelId(role, env)) as LanguageModel;
}

/** Test seam: forget the memoised provider so a new key takes effect. */
export function resetProvider(): void {
  cached = null;
}
