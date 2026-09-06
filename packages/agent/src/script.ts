import { callOrder, questionFor, vocabularyFor, type CallLanguage, type ScriptCriterion } from "./criteria";
import { frameEpilogue, framePrologue, type CallMedium } from "./frame";

export type CallScript = {
  /** The assembled system prompt. */
  system: string;
  /** The criteria in the order the agent will ask them. */
  order: ScriptCriterion[];
  /**
   * How many questions the call carries. The portal's budget warning counts the
   * same thing, so the warning and the script can never disagree.
   */
  questionCount: number;
};

export type BuildCallScriptInput = {
  criteria: ScriptCriterion[];
  language: CallLanguage;
  /** Shown to the lead only as a name; never used to reveal scoring. */
  leadName?: string;
  /**
   * Where this script will be used. `voice` adds the live-call section of the
   * frame; the criteria, the order, the guardrails and the budget are identical
   * either way (voice-bridge design D7). Defaults to `text`, so every existing
   * caller assembles exactly the prompt it assembled before.
   */
  medium?: CallMedium;
};

/**
 * Renders one criterion as a line of the question list.
 *
 * Enum criteria carry their `options` vocabulary — the full set of things a
 * lead may be recorded as answering, never the `expected_value` subset that
 * passes. Constraining the agent to what passes would make a failing answer
 * unsayable, which is the same mistake `@solarwave/scoring` avoids in its
 * extraction schema, and both read the vocabulary through `parseOptionList` so
 * they cannot disagree about what a member is.
 */
function questionLine(criterion: ScriptCriterion, language: CallLanguage): string {
  const parts = [`- [${criterion.key}] ${questionFor(criterion, language)}`];

  const vocabulary = vocabularyFor(criterion);
  if (vocabulary.length > 0) {
    parts.push(`  Record the answer as one of: ${vocabulary.join(", ")}.`);
  }
  if (criterion.type === "numeric") {
    parts.push("  Record the answer as a number. An approximate figure is fine; do not push for precision.");
  }
  if (criterion.type === "boolean") {
    parts.push("  Record the answer as true or false.");
  }
  if (criterion.blocking) {
    parts.push("  This question is blocking: if the answer does not qualify the lead, close the call warmly.");
  }

  return parts.join("\n");
}

/**
 * Assembles the call script from the active criteria (design D4).
 *
 * The shape is fixed frame, then criteria as data under an explicit heading,
 * then fixed frame again. No conversational prose is hand-written per criterion
 * anywhere in the system: deactivating a criterion in the portal shortens the
 * next call, with no code change.
 */
export function buildCallScript({
  criteria,
  language,
  leadName,
  medium = "text",
}: BuildCallScriptInput): CallScript {
  const order = callOrder(criteria);

  const questions =
    order.length > 0
      ? order.map((c) => questionLine(c, language)).join("\n")
      : "- (no questions are configured; greet the lead, explain a specialist will follow up, and end the call)";

  const system = [
    framePrologue(language, medium),
    "",
    leadName ? `The person you are calling is ${leadName}.` : "",
    leadName ? "" : "",
    questions,
    "",
    frameEpilogue(),
  ]
    .filter((part, index, all) => !(part === "" && all[index - 1] === ""))
    .join("\n");

  return { system, order, questionCount: order.length };
}
