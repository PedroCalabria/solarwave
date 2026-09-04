import type { QualificationDecision } from "./lifecycle";
import { err, ok, type Result } from "./result";

export const CRITERION_TYPES = ["boolean", "numeric", "enum", "free_text"] as const;
export type CriterionType = (typeof CRITERION_TYPES)[number];

export type ScoringCriterion = {
  key: string;
  type: CriterionType;
  /** Rule text in the per-type grammar (design D5). Ignored for free_text. */
  expectedValue: string | null;
  /** 0-100 */
  weight: number;
  blocking: boolean;
  active: boolean;
};

/** A normalised answer. `null`/`undefined` means "not answered". */
export type AnswerValue = boolean | number | string | null | undefined;

export type ScoringAnswer = {
  criterionKey: string;
  value: AnswerValue;
};

export type ScoringSettings = {
  /** 0-100, default 70 */
  handoffThreshold: number;
  /** 0-1, default 0.6 */
  minAnsweredWeightShare: number;
};

export const DEFAULT_SETTINGS: ScoringSettings = {
  handoffThreshold: 70,
  minAnsweredWeightShare: 0.6,
};

export type Rule =
  | { kind: "boolean"; expected: boolean }
  | { kind: "numeric"; op: ">=" | ">" | "<=" | "<" | "="; value: number }
  | { kind: "range"; min: number; max: number }
  | { kind: "enum"; accepted: string[] }
  | { kind: "any" };

export type RuleError = { criterionKey?: string; message: string };

const NUMERIC_CMP = /^(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)$/;
const NUMERIC_RANGE = /^(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)$/;

/** Parses `expected_value` for a criterion type. */
export function parseExpectedValue(type: CriterionType, raw: string | null): Result<Rule, RuleError> {
  const text = (raw ?? "").trim();

  switch (type) {
    case "free_text":
      return ok({ kind: "any" });

    case "boolean": {
      const lower = text.toLowerCase();
      if (lower === "true" || lower === "false") return ok({ kind: "boolean", expected: lower === "true" });
      return err({ message: 'boolean criteria expect "true" or "false"' });
    }

    case "numeric": {
      const cmp = NUMERIC_CMP.exec(text);
      if (cmp) {
        return ok({ kind: "numeric", op: cmp[1] as ">=" | ">" | "<=" | "<" | "=", value: Number(cmp[2]) });
      }
      const range = NUMERIC_RANGE.exec(text);
      if (range) {
        const min = Number(range[1]);
        const max = Number(range[2]);
        if (min > max) return err({ message: "range minimum must not exceed maximum" });
        return ok({ kind: "range", min, max });
      }
      return err({ message: 'numeric criteria expect a comparator like ">= 300" or a range like "300..1500"' });
    }

    case "enum": {
      const accepted = text
        .split("|")
        .map((v) => v.trim().toLowerCase())
        .filter((v) => v.length > 0);
      if (accepted.length === 0) return err({ message: 'enum criteria expect accepted values separated by "|"' });
      return ok({ kind: "enum", accepted });
    }
  }
}

function isAnswered(value: AnswerValue): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function asNumber(value: AnswerValue): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const n = Number(value.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asBoolean(value: AnswerValue): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
  }
  return null;
}

/** Whether an answered value satisfies a parsed rule. Unanswered values never pass. */
export function evaluateRule(rule: Rule, value: AnswerValue): boolean {
  if (!isAnswered(value)) return false;

  switch (rule.kind) {
    case "any":
      return true;
    case "boolean": {
      const b = asBoolean(value);
      return b !== null && b === rule.expected;
    }
    case "numeric": {
      const n = asNumber(value);
      if (n === null) return false;
      switch (rule.op) {
        case ">=":
          return n >= rule.value;
        case ">":
          return n > rule.value;
        case "<=":
          return n <= rule.value;
        case "<":
          return n < rule.value;
        case "=":
          return n === rule.value;
      }
      return false;
    }
    case "range": {
      const n = asNumber(value);
      return n !== null && n >= rule.min && n <= rule.max;
    }
    case "enum":
      return typeof value === "string" && rule.accepted.includes(value.trim().toLowerCase());
  }
}

/** Convenience: parse and evaluate in one step. Returns an error for a malformed rule. */
export function evaluateAnswer(criterion: ScoringCriterion, value: AnswerValue): Result<boolean, RuleError> {
  const rule = parseExpectedValue(criterion.type, criterion.expectedValue);
  if (!rule.ok) return err({ criterionKey: criterion.key, message: rule.error.message });
  return ok(evaluateRule(rule.value, value));
}

export type ScoreResult = {
  /** 0-100, normalised over the weight of active criteria. */
  score: number;
  passedKeys: string[];
  failedKeys: string[];
  unansweredKeys: string[];
  /** Active blocking criteria that were answered and failed. */
  failedBlocking: string[];
  /** Sum of weights of answered active criteria divided by the sum of active weights. */
  answeredWeightShare: number;
  enoughInformation: boolean;
  decision: QualificationDecision;
};

export type ScoreInput = {
  criteria: ScoringCriterion[];
  answers: ScoringAnswer[];
  settings: ScoringSettings;
};

function activeOnly(criteria: ScoringCriterion[]): ScoringCriterion[] {
  return criteria.filter((c) => c.active);
}

function answerMap(answers: ScoringAnswer[]): Map<string, AnswerValue> {
  const map = new Map<string, AnswerValue>();
  for (const a of answers) map.set(a.criterionKey, a.value);
  return map;
}

/**
 * Spec section 4.5 "enough information": every active blocking criterion is
 * answered AND the answered share of active weight is at least `minShare`.
 */
export function hasEnoughInformation(
  criteria: ScoringCriterion[],
  answers: ScoringAnswer[],
  minShare: number,
): boolean {
  const active = activeOnly(criteria);
  const map = answerMap(answers);

  const blockingUnanswered = active.some((c) => c.blocking && !isAnswered(map.get(c.key)));
  if (blockingUnanswered) return false;

  return answeredWeightShare(active, map) >= minShare;
}

function answeredWeightShare(active: ScoringCriterion[], map: Map<string, AnswerValue>): number {
  const total = active.reduce((sum, c) => sum + c.weight, 0);
  if (total === 0) return 0;
  const answered = active.filter((c) => isAnswered(map.get(c.key))).reduce((sum, c) => sum + c.weight, 0);
  return answered / total;
}

/**
 * Deterministic scoring engine (design D5). Pure function of its input; no I/O.
 * Returns validation errors when any active criterion has a malformed rule.
 */
export function scoreLead({ criteria, answers, settings }: ScoreInput): Result<ScoreResult, RuleError[]> {
  const active = activeOnly(criteria);
  const map = answerMap(answers);

  const errors: RuleError[] = [];
  const rules = new Map<string, Rule>();
  for (const c of active) {
    const parsed = parseExpectedValue(c.type, c.expectedValue);
    if (parsed.ok) rules.set(c.key, parsed.value);
    else errors.push({ criterionKey: c.key, message: parsed.error.message });
  }
  if (errors.length > 0) return err(errors);

  const passedKeys: string[] = [];
  const failedKeys: string[] = [];
  const unansweredKeys: string[] = [];
  const failedBlocking: string[] = [];

  let passedWeight = 0;
  let activeWeight = 0;

  for (const c of active) {
    activeWeight += c.weight;
    const value = map.get(c.key);
    if (!isAnswered(value)) {
      unansweredKeys.push(c.key);
      continue;
    }
    const passed = evaluateRule(rules.get(c.key)!, value);
    if (passed) {
      passedKeys.push(c.key);
      passedWeight += c.weight;
    } else {
      failedKeys.push(c.key);
      if (c.blocking) failedBlocking.push(c.key);
    }
  }

  const score = activeWeight === 0 ? 0 : Math.round((100 * passedWeight) / activeWeight);
  const share = answeredWeightShare(active, map);
  const enoughInformation = hasEnoughInformation(criteria, answers, settings.minAnsweredWeightShare);

  const decision: QualificationDecision =
    failedBlocking.length > 0 ? "disqualified" : score >= settings.handoffThreshold ? "qualified" : "disqualified";

  return ok({
    score,
    passedKeys,
    failedKeys,
    unansweredKeys,
    failedBlocking,
    answeredWeightShare: share,
    enoughInformation,
    decision,
  });
}
