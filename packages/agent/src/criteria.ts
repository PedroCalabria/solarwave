import { parseOptionList, type CriterionType } from "@solarwave/core";

/**
 * The criterion fields the conversation needs. Deliberately not the database
 * row, matching what `@solarwave/scoring` does for extraction: the script cares
 * about questions and ordering, not about audit columns.
 */
export type ScriptCriterion = {
  key: string;
  label: string;
  questionPt: string;
  questionEn: string;
  type: CriterionType;
  /** Enum vocabulary, pipe-separated. Null for every other type. */
  options: string | null;
  expectedValue: string | null;
  weight: number;
  blocking: boolean;
  active: boolean;
  sortOrder: number;
};

/**
 * The order the agent asks the questions in — which is NOT the order the portal
 * lists them in (design D5).
 *
 * Two orderings exist and conflating them was the mistake this function ends.
 * `sort_order` is admin-controlled and audited, and it keeps driving the portal
 * list. The call needs something else: a blocking criterion has to be asked
 * early, because failing one ends the call, and finding that out in the last
 * 20 seconds wastes the whole two-minute budget.
 *
 * So `sort_order` is demoted to a tiebreak rather than ignored — an admin who
 * reorders two criteria of equal weight still gets what they asked for — and
 * `key` is the final tiebreak so the same criteria always produce the same
 * script. Inactive criteria are dropped here, once, rather than in every caller.
 */
export function callOrder(criteria: ScriptCriterion[]): ScriptCriterion[] {
  return criteria
    .filter((c) => c.active)
    .slice()
    .sort(
      (a, b) =>
        Number(b.blocking) - Number(a.blocking) ||
        b.weight - a.weight ||
        a.sortOrder - b.sortOrder ||
        a.key.localeCompare(b.key),
    );
}

/** The question text for a criterion in the call's language. */
export function questionFor(criterion: ScriptCriterion, language: CallLanguage): string {
  return language === "pt" ? criterion.questionPt : criterion.questionEn;
}

export type CallLanguage = "pt" | "en";

/** The vocabulary an enum criterion may be answered with. Empty for other types. */
export function vocabularyFor(criterion: ScriptCriterion): string[] {
  return criterion.type === "enum" ? parseOptionList(criterion.options) : [];
}
