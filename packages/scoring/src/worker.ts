import type { LanguageModel } from "@solarwave/ai";
import {
  evaluateAnswer,
  isTerminal,
  scoreLead,
  type LeadEvent,
  type RuleError,
  type ScoringAnswer,
  type ScoringCriterion,
} from "@solarwave/core";
import {
  clearNextCall,
  getSettings,
  loadAttemptForScoring,
  replaceViolations,
  saveScoringResult,
  setScoringStatus,
  type AnswerRow,
  type AttemptForScoring,
  type Criterion,
  type Db,
  type TranscriptTurn,
} from "@solarwave/db";
import { extractAnswers, type ExtractedAnswer } from "./extract";
import { generateNarrative, type CallLanguage } from "./narrative";
import { blocksOutreach } from "./guardrails";
import { judgeTranscript, type Finding } from "./judge";
import type { ExtractionCriterion } from "./extractionSchema";

export type ScoringDeps = {
  db: Db;
  extractionModel: LanguageModel;
  narrativeModel: LanguageModel;
  judgeModel: LanguageModel;
  maxRetries?: number;
};

export type ScoringOutcome =
  /** Answers, score and narrative persisted; `scoring_status` is `done`. */
  | {
      status: "done";
      score: number;
      decision: "qualified" | "disqualified";
      leadStatus: string;
      findings: Finding[];
      /** True when the judge could not run. The score stands; the audit does not. */
      auditIncomplete: boolean;
    }
  /** The attempt is unscoreable as configured. `scoring_status` stays `pending`. */
  | { status: "invalid"; reason: "not_found" | "no_transcript"; errors?: RuleError[] }
  | { status: "invalid"; reason: "invalid_criteria"; errors: RuleError[] }
  /** Retries exhausted. `scoring_status` is `failed` and the lead is untouched. */
  | { status: "failed"; message: string };

function toExtractionCriteria(criteria: Criterion[]): ExtractionCriterion[] {
  return criteria.map((c) => ({
    key: c.key,
    label: c.label,
    type: c.type,
    options: c.options,
    expectedValue: c.expectedValue,
    active: c.active,
  }));
}

function toScoringCriteria(criteria: Criterion[]): ScoringCriterion[] {
  return criteria.map((c) => ({
    key: c.key,
    type: c.type,
    expectedValue: c.expectedValue,
    weight: c.weight,
    blocking: c.blocking,
    active: c.active,
  }));
}

/** The value as a human reads it in the portal, alongside the typed value. */
function renderValue(value: ExtractedAnswer["value"]): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

export function toAnswerRows(
  answers: ExtractedAnswer[],
  criteria: Criterion[],
): { rows: AnswerRow[]; errors: RuleError[] } {
  const byKey = new Map(criteria.map((c) => [c.key, c]));
  const rows: AnswerRow[] = [];
  const errors: RuleError[] = [];

  for (const answer of answers) {
    const criterion = byKey.get(answer.criterionKey);
    if (!criterion) continue;

    const verdict = evaluateAnswer(
      {
        key: criterion.key,
        type: criterion.type,
        expectedValue: criterion.expectedValue,
        weight: criterion.weight,
        blocking: criterion.blocking,
        active: criterion.active,
      },
      answer.value,
    );
    if (!verdict.ok) {
      errors.push(verdict.error);
      continue;
    }

    rows.push({
      criteriaId: criterion.id,
      extractedValue: renderValue(answer.value),
      normalizedValue: answer.value,
      confidence: answer.confidence,
      evidence: answer.evidence,
      passed: answer.value === null ? null : verdict.value,
    });
  }

  return { rows, errors };
}

/**
 * Decides whether this run also moves the lead.
 *
 * Only a completed call that has not already reached a terminal status
 * transitions. A re-score of a lead that already qualified updates its score
 * without replaying the lifecycle, and a failed scoring never gets here at all
 * (design D3).
 */
export function transitionEvent(
  loaded: AttemptForScoring,
  decision: "qualified" | "disqualified",
): LeadEvent | undefined {
  if (loaded.attempt.outcome !== "answered_complete") return undefined;
  if (isTerminal(loaded.lead.status)) return undefined;
  return {
    type: "attempt_ended",
    outcome: "answered_complete",
    attemptCount: loaded.attempt.attemptNumber,
    decision,
  };
}

/**
 * Scores one call attempt end to end: extract, apply the deterministic engine,
 * write the narrative, persist everything in one transaction.
 *
 * A failure after the retries are exhausted marks `scoring_status = 'failed'`
 * and leaves the lead exactly where it was. Inventing a decision for a call
 * that was never scored would put a fabricated qualification in front of a
 * human, so the worker would rather leave a visible pending (design D3).
 */
export async function scoreAttempt(deps: ScoringDeps, attemptId: string): Promise<ScoringOutcome> {
  const loaded = await loadAttemptForScoring(deps.db, attemptId);
  if (!loaded) return { status: "invalid", reason: "not_found" };

  const transcript = (loaded.attempt.transcript ?? []) as TranscriptTurn[];
  if (transcript.length === 0) return { status: "invalid", reason: "no_transcript" };

  await setScoringStatus(deps.db, attemptId, "running");

  const extracted = await extractAnswers({
    criteria: toExtractionCriteria(loaded.criteria),
    transcript,
    model: deps.extractionModel,
    maxRetries: deps.maxRetries,
  });

  if (!extracted.ok) {
    if (extracted.error.kind === "invalid_criteria") {
      // Not a model failure: the criteria could never have been scored. Leave
      // the attempt pending so fixing the criteria makes it scoreable.
      await setScoringStatus(deps.db, attemptId, "pending");
      return { status: "invalid", reason: "invalid_criteria", errors: extracted.error.errors };
    }
    if (extracted.error.kind === "no_transcript") {
      await setScoringStatus(deps.db, attemptId, "pending");
      return { status: "invalid", reason: "no_transcript" };
    }
    await setScoringStatus(deps.db, attemptId, "failed");
    return { status: "failed", message: extracted.error.error.message };
  }

  const { rows, errors } = toAnswerRows(extracted.value, loaded.criteria);
  if (errors.length > 0) {
    await setScoringStatus(deps.db, attemptId, "pending");
    return { status: "invalid", reason: "invalid_criteria", errors };
  }

  const settings = await getSettings(deps.db);
  const answers: ScoringAnswer[] = extracted.value.map((a) => ({ criterionKey: a.criterionKey, value: a.value }));
  const scored = scoreLead({ criteria: toScoringCriteria(loaded.criteria), answers, settings });
  if (!scored.ok) {
    await setScoringStatus(deps.db, attemptId, "pending");
    return { status: "invalid", reason: "invalid_criteria", errors: scored.error };
  }

  // The judge runs before the narrative on purpose. A lead who asked not to be
  // contacted, and whom the live agent missed, must not have outreach text
  // written for them in the same run that discovers it. A judge failure is not
  // fatal: the score stands and the audit is reported as unfinished.
  const judged = await judgeTranscript({
    model: deps.judgeModel,
    transcript,
    optOutAlreadyRecorded: loaded.attempt.outcome === "opt_out" || loaded.lead.status === "opt_out",
    maxRetries: deps.maxRetries,
  });
  const findings: Finding[] = judged.ok ? judged.value : [];
  const auditIncomplete = !judged.ok;

  if (judged.ok) {
    await replaceViolations(deps.db, attemptId, findings.map((f) => ({ callAttemptId: attemptId, ...f })));
    if (findings.some((f) => blocksOutreach(f.guardrail))) {
      await clearNextCall(deps.db, loaded.lead.id);
    }
  }

  const suppressOutreach = loaded.suppressOutreach || findings.some((f) => blocksOutreach(f.guardrail));

  const labels = Object.fromEntries(loaded.criteria.map((c) => [c.key, c.label]));
  const narrative = await generateNarrative({
    model: deps.narrativeModel,
    language: loaded.lead.preferredCallLanguage as CallLanguage,
    leadName: loaded.lead.name,
    labels,
    score: scored.value,
    answers: extracted.value,
    transcript,
    includeIcebreaker: !suppressOutreach,
    maxRetries: deps.maxRetries,
  });

  if (!narrative.ok) {
    // Nothing has been written yet: the whole run is one transaction below, so
    // the attempt keeps no partial answers.
    await setScoringStatus(deps.db, attemptId, "failed");
    return { status: "failed", message: narrative.error.error.message };
  }

  const saved = await saveScoringResult(deps.db, {
    attemptId,
    leadId: loaded.lead.id,
    answers: rows,
    score: scored.value.score,
    reason: narrative.value.reason,
    icebreaker: narrative.value.icebreaker,
    event: transitionEvent(loaded, scored.value.decision),
  });

  if (!saved.ok) {
    await setScoringStatus(deps.db, attemptId, "failed");
    return { status: "failed", message: `could not persist: ${JSON.stringify(saved.error)}` };
  }

  return {
    status: "done",
    score: scored.value.score,
    decision: scored.value.decision,
    leadStatus: saved.lead.status,
    findings,
    auditIncomplete,
  };
}
