/**
 * Presentation helpers for the portal. Data comes from `@solarwave/db`;
 * nothing in this module holds records.
 */

import { LEAD_STATUSES, MAX_ATTEMPTS, type AttemptOutcome, type LeadStatus } from "@solarwave/core";
import type { Lead, CallAttempt, Criterion } from "@solarwave/db";

export type { Lead, CallAttempt, Criterion, LeadStatus, AttemptOutcome };
export { MAX_ATTEMPTS };

export type StatusStyle = {
  label: LeadStatus;
  bg: string;
  fg: string;
  border: string;
  /** CSS `animation` shorthand for the badge dot. */
  dot: string;
};

const NONE = "none";
const PULSE = "solPulse 1600ms var(--ease-out) infinite";

export const STATUS: Record<LeadStatus, StatusStyle> = {
  new: { label: "new", bg: "var(--ink-100)", fg: "var(--ink-700)", border: "1px solid transparent", dot: NONE },
  calling: { label: "calling", bg: "var(--white)", fg: "var(--ink-900)", border: "1.5px solid var(--ink-900)", dot: PULSE },
  waiting_retry: { label: "waiting_retry", bg: "var(--white)", fg: "var(--ink-700)", border: "1px dashed var(--ink-300)", dot: NONE },
  no_answer_final: { label: "no_answer_final", bg: "var(--ink-050)", fg: "var(--ink-400)", border: "1px solid transparent", dot: NONE },
  qualified: { label: "qualified", bg: "var(--ink-900)", fg: "var(--white)", border: "1px solid var(--ink-900)", dot: NONE },
  disqualified: { label: "disqualified", bg: "var(--ink-200)", fg: "var(--ink-800)", border: "1px solid transparent", dot: NONE },
  opt_out: { label: "opt_out", bg: "transparent", fg: "var(--ink-900)", border: "1px solid var(--ink-900)", dot: NONE },
};

export const STATUS_KEYS: LeadStatus[] = [...LEAD_STATUSES];

export function isLeadStatus(value: string): value is LeadStatus {
  return (LEAD_STATUSES as readonly string[]).includes(value);
}

/** Hand-off threshold is configurable; bands below it read progressively quieter. */
export function scoreColor(score: number | null, threshold = 70): string {
  if (score === null || score === undefined) return "var(--ink-400)";
  if (score >= threshold) return "var(--ink-900)";
  if (score >= threshold - 25) return "var(--ink-700)";
  return "var(--ink-400)";
}

export const OUTCOME_LABEL: Record<AttemptOutcome, string> = {
  answered_complete: "Completed",
  answered_incomplete: "Answered — incomplete",
  no_answer: "No answer",
  voicemail: "Voicemail",
  busy: "Busy",
  failed: "Failed",
  abusive: "Ended — abusive",
  minor_answered: "Ended — minor answered",
  opt_out: "Opt-out requested",
};

export function outcomeLabel(attempt: Pick<CallAttempt, "outcome" | "startedAt" | "endedAt">): string {
  if (attempt.outcome) return OUTCOME_LABEL[attempt.outcome];
  if (attempt.startedAt && !attempt.endedAt) return "In progress";
  return "Scheduled";
}

const PORTAL_TZ = process.env.PORTAL_TIMEZONE ?? process.env.NEXT_PUBLIC_PORTAL_TIMEZONE ?? "America/Sao_Paulo";

const dateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: PORTAL_TZ,
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const dateTimeYear = new Intl.DateTimeFormat("en-GB", {
  timeZone: PORTAL_TZ,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "2 Sep, 09:14" */
export function formatDateTime(date: Date | null | undefined): string {
  if (!date) return "—";
  return dateTime.format(date).replace(",", ",");
}

/** "28 Aug 2026, 14:12" */
export function formatDateTimeYear(date: Date | null | undefined): string {
  if (!date) return "—";
  return dateTimeYear.format(date);
}

/** "2m 41s" between two instants, or "—". */
export function formatDuration(start: Date | null | undefined, end: Date | null | undefined): string {
  if (!start || !end) return "—";
  const secs = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
  return `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`;
}

/** "+5511988421170" -> "+55 11 98842-1170" */
export function formatPhone(e164: string): string {
  const m = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  if (!m) return e164;
  return `+55 ${m[1]} ${m[2]}-${m[3]}`;
}

export function languageLabel(code: "pt" | "en"): string {
  return code === "en" ? "English" : "Portuguese";
}

/** Question budget (criteria-management spec): more than six active criteria will not fit two minutes. */
export const QUESTION_BUDGET = 6;

export function criterionTypeLabel(type: Criterion["type"]): string {
  return type;
}
