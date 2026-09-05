import { evaluateAnswer, scoreLead, type RuleError, type ScoringAnswer } from "@solarwave/core";
import {
  auditChangesSince,
  getSettings,
  loadAnswerRows,
  loadAttemptForScoring,
  saveScoringResult,
  transcriptAvailable,
  type Db,
} from "@solarwave/db";
import { classifyStaleness, type Staleness } from "./staleness";
import { scoreAttempt, type ScoringDeps, type ScoringOutcome } from "./worker";

export type StalenessReport = Staleness & { attemptId: string };

/**
 * Whether a scored attempt still reflects the current criteria.
 *
 * Nothing here recomputes: saving a criterion marks leads stale and rewrites no
 * score. An employee decides when, and the report says which action applies so
 * they know whether they are about to spend a model call (design D9).
 */
export async function reportStaleness(db: Db, attemptId: string): Promise<StalenessReport | null> {
  const loaded = await loadAttemptForScoring(db, attemptId);
  if (!loaded) return null;

  const scoredAt = loaded.attempt.scoredAt;
  const changes = scoredAt ? await auditChangesSince(db, scoredAt) : [];

  return {
    attemptId,
    ...classifyStaleness({
      scoredAt,
      changes,
      transcriptAvailable: transcriptAvailable(loaded.attempt),
    }),
  };
}

export type RescoreOutcome =
  | { status: "done"; score: number; decision: "qualified" | "disqualified" }
  | { status: "invalid"; reason: "not_found" | "no_answers"; errors?: RuleError[] }
  | { status: "invalid"; reason: "invalid_criteria"; errors: RuleError[] }
  | { status: "failed"; message: string };

/**
 * Reruns the deterministic engine over the answers already stored. No model, no
 * transcript, no cost. Idempotent by construction: the same answers, criteria
 * and settings always produce the same score.
 *
 * The narrative is left as it was. It describes the same answers, and rewriting
 * it would mean a model call, which is exactly what this path exists to avoid.
 */
export async function rescoreAttempt(db: Db, attemptId: string): Promise<RescoreOutcome> {
  const loaded = await loadAttemptForScoring(db, attemptId);
  if (!loaded) return { status: "invalid", reason: "not_found" };

  const stored = await loadAnswerRows(db, attemptId);
  if (stored.length === 0) return { status: "invalid", reason: "no_answers" };

  const settings = await getSettings(db);
  const byKey = new Map(loaded.criteria.map((c) => [c.key, c]));

  const answers: ScoringAnswer[] = stored.map((a) => ({
    criterionKey: a.criterionKey,
    value: a.normalizedValue as ScoringAnswer["value"],
  }));

  const scored = scoreLead({
    criteria: loaded.criteria.map((c) => ({
      key: c.key,
      type: c.type,
      expectedValue: c.expectedValue,
      weight: c.weight,
      blocking: c.blocking,
      active: c.active,
    })),
    answers,
    settings,
  });
  if (!scored.ok) return { status: "invalid", reason: "invalid_criteria", errors: scored.error };

  // Re-evaluate each verdict against the current rule, keeping the confidence
  // and evidence the extraction produced: a re-score re-judges answers, it does
  // not re-observe the call.
  const errors: RuleError[] = [];
  const rows = stored.map((row) => {
    const criterion = byKey.get(row.criterionKey);
    if (!criterion) return row;
    const value = row.normalizedValue as ScoringAnswer["value"];
    if (value === null || value === undefined) return { ...row, passed: null };

    const verdict = evaluateAnswer(
      {
        key: criterion.key,
        type: criterion.type,
        expectedValue: criterion.expectedValue,
        weight: criterion.weight,
        blocking: criterion.blocking,
        active: criterion.active,
      },
      value,
    );
    if (!verdict.ok) {
      errors.push(verdict.error);
      return row;
    }
    return { ...row, passed: verdict.value };
  });
  if (errors.length > 0) return { status: "invalid", reason: "invalid_criteria", errors };

  const saved = await saveScoringResult(db, {
    attemptId,
    leadId: loaded.lead.id,
    answers: rows.map(({ criterionKey: _key, ...row }) => row),
    score: scored.value.score,
    reason: loaded.lead.qualificationReason ?? "",
    icebreaker: loaded.lead.icebreaker,
  });
  if (!saved.ok) return { status: "failed", message: JSON.stringify(saved.error) };

  return { status: "done", score: scored.value.score, decision: scored.value.decision };
}

/**
 * Reads the transcript again with a model, for changes the stored answers
 * cannot express: a criterion that did not exist, one that was reactivated, a
 * changed type, or a moved vocabulary.
 */
export async function reprocessAttempt(deps: ScoringDeps, attemptId: string): Promise<ScoringOutcome> {
  const loaded = await loadAttemptForScoring(deps.db, attemptId);
  if (!loaded) return { status: "invalid", reason: "not_found" };
  if (!transcriptAvailable(loaded.attempt)) {
    // Purged under the twelve-month retention of spec section 10. The last
    // score stands, frozen, rather than being recomputed from nothing.
    return { status: "invalid", reason: "no_transcript" };
  }
  return scoreAttempt(deps, attemptId);
}
