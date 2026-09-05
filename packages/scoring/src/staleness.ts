/**
 * What a criteria change costs to reflect in an existing score.
 *
 * `rescore` reruns the deterministic engine over the answers already stored:
 * free, instant, no model. `reprocess` has to read the transcript again with a
 * model, because the stored answers cannot express the new configuration.
 */
export type Recomputation = "none" | "rescore" | "reprocess";

export type AuditChange = {
  /** `criteria_audit_log.field`, e.g. `weight`, `options`, `setting:handoff_threshold`. */
  field: string;
  oldValue: string | null;
  newValue: string | null;
};

const RESCORE_FIELDS = new Set([
  "weight",
  "blocking",
  "sortOrder",
  "sort_order",
  "deleted",
  // Which values pass can change freely: the stored value is still a member of
  // the unchanged vocabulary and only needs re-evaluating (design D5).
  "expectedValue",
  "expected_value",
]);

const REPROCESS_FIELDS = new Set([
  // A criterion that did not exist has no answer row anywhere.
  "created",
  "type",
  // The vocabulary itself moved, so a stored value may no longer be a member.
  "options",
]);

/**
 * Fields that never affect a score. `key` is here because stored answers link
 * to a criterion by id, not by key: renaming it moves nothing.
 */
const COSMETIC_FIELDS = new Set(["key", "label", "questionPt", "question_pt", "questionEn", "question_en"]);

const RANK: Record<Recomputation, number> = { none: 0, rescore: 1, reprocess: 2 };

function isTrue(value: string | null): boolean {
  return value?.trim().toLowerCase() === "true";
}

/**
 * Classifies one audit row. Deterministic, from the field name and the recorded
 * values only — no heuristic and no model.
 */
export function classifyChange(change: AuditChange): Recomputation {
  const field = change.field.trim();

  if (field.startsWith("setting:")) return "rescore";
  if (COSMETIC_FIELDS.has(field)) return "none";
  if (REPROCESS_FIELDS.has(field)) return "reprocess";

  if (field === "active") {
    // Deactivating drops the criterion from the score. Reactivating needs an
    // answer that was never extracted while it was off.
    return isTrue(change.newValue) && !isTrue(change.oldValue) ? "reprocess" : "rescore";
  }

  if (RESCORE_FIELDS.has(field)) return "rescore";

  // An unrecognised field is treated as needing the cheap path rather than
  // being ignored: a score that silently goes stale is worse than an offer to
  // recompute for free.
  return "rescore";
}

/** The most expensive path any of the changes requires. */
export function classifyChanges(changes: AuditChange[]): Recomputation {
  return changes.reduce<Recomputation>(
    (worst, change) => {
      const next = classifyChange(change);
      return RANK[next] > RANK[worst] ? next : worst;
    },
    "none",
  );
}

export type StalenessInput = {
  /** Null when the attempt has never been scored. */
  scoredAt: Date | null;
  /** Audit rows newer than `scoredAt`. */
  changes: AuditChange[];
  /** False once the twelve-month retention has purged the transcript. */
  transcriptAvailable: boolean;
};

export type Staleness =
  | { state: "never_scored" }
  | { state: "fresh" }
  | {
      state: "stale";
      /** What the change requires. */
      required: "rescore" | "reprocess";
      /** What can actually be offered: reprocessing needs a transcript. */
      available: "rescore" | "reprocess" | "none";
    };

/**
 * Whether a scored attempt still reflects the current criteria, and what it
 * would take to refresh it (design D9).
 */
export function classifyStaleness({ scoredAt, changes, transcriptAvailable }: StalenessInput): Staleness {
  if (scoredAt === null) return { state: "never_scored" };

  const required = classifyChanges(changes);
  if (required === "none") return { state: "fresh" };

  if (required === "reprocess") {
    // Without a transcript the score is frozen: reprocessing is impossible and
    // a pure re-score would not pick up the change either.
    return { state: "stale", required, available: transcriptAvailable ? "reprocess" : "none" };
  }

  return { state: "stale", required: "rescore", available: "rescore" };
}
