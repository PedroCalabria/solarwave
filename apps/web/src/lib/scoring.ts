import "server-only";

import { modelFor } from "@solarwave/ai";
import { getDb } from "@solarwave/db";
import type { ScoringDeps } from "@solarwave/scoring";

/**
 * Wires the worker to the real models. Ids and the API key come from the
 * environment because the Gemini catalogue moves fast; `modelFor` fails loudly
 * rather than letting a stale id surface as a 400 mid-call (design D12).
 *
 * Tests pass a mock model into the same three slots and never reach this file.
 */
export function scoringDeps(): ScoringDeps {
  return {
    db: getDb(),
    extractionModel: modelFor("extraction"),
    narrativeModel: modelFor("narrative"),
    judgeModel: modelFor("judge"),
  };
}

/**
 * Guards the internal scoring route. Change 5's workflow calls the exported
 * function directly; this shared secret only protects the HTTP door.
 */
export function isAuthorisedWorkerCall(request: Request): boolean {
  const expected = process.env.SCORING_WORKER_SECRET?.trim();
  if (!expected) return false;
  const provided = request.headers.get("x-scoring-secret")?.trim();
  return Boolean(provided) && provided === expected;
}
