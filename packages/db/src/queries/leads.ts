import { LEAD_STATUSES, localToInstant, toLocalParts, type LeadStatus } from "@solarwave/core";
import { and, asc, count, desc, eq, gte, ilike, isNotNull, or, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "../client";
import {
  callAttempts,
  leads,
  qualificationAnswers,
  qualificationCriteria,
  type CallAttempt,
  type Criterion,
  type Lead,
  type QualificationAnswer,
} from "../schema";

export type LeadListFilter = {
  status?: LeadStatus | "all";
  query?: string;
  limit?: number;
};

/** Newest first, optional status filter and free-text search on name, phone, email. */
export async function listLeads(db: DbOrTx, filter: LeadListFilter = {}): Promise<Lead[]> {
  const conditions: SQL[] = [];
  if (filter.status && filter.status !== "all") conditions.push(eq(leads.status, filter.status));
  const q = filter.query?.trim();
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(or(ilike(leads.name, pattern), ilike(leads.phone, pattern), ilike(leads.email, pattern))!);
  }
  return db
    .select()
    .from(leads)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(leads.createdAt))
    .limit(filter.limit ?? 500);
}

export type StatusCounts = Record<LeadStatus | "all", number>;

export async function countLeadsByStatus(db: DbOrTx): Promise<StatusCounts> {
  const rows = await db.select({ status: leads.status, n: count() }).from(leads).groupBy(leads.status);
  const counts = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as StatusCounts;
  counts.all = 0;
  for (const row of rows) {
    counts[row.status] = Number(row.n);
    counts.all += Number(row.n);
  }
  return counts;
}

export type AnswerWithCriterion = QualificationAnswer & { criterion: Criterion };
export type AttemptWithAnswers = CallAttempt & { answers: AnswerWithCriterion[] };

export type LeadDetail = Lead & {
  attempts: AttemptWithAnswers[];
  /** Latest attempt that has answers (scored), or null. */
  latestScoredAttempt: AttemptWithAnswers | null;
  /** Latest attempt that has a transcript, or null. */
  latestTranscriptAttempt: CallAttempt | null;
};

export async function getLeadDetail(db: DbOrTx, id: string): Promise<LeadDetail | null> {
  const lead = await db.query.leads.findFirst({
    where: eq(leads.id, id),
    with: {
      attempts: {
        orderBy: asc(callAttempts.attemptNumber),
        with: { answers: { with: { criterion: true } } },
      },
    },
  });
  if (!lead) return null;

  const attempts = lead.attempts as AttemptWithAnswers[];
  const latestScoredAttempt = [...attempts].reverse().find((a) => a.answers.length > 0) ?? null;
  const latestTranscriptAttempt =
    [...attempts].reverse().find((a) => a.transcript && a.transcript.length > 0) ?? null;

  return { ...lead, attempts, latestScoredAttempt, latestTranscriptAttempt };
}

export async function getLeadById(db: DbOrTx, id: string): Promise<Lead | null> {
  const rows = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getLeadByPhone(db: DbOrTx, phone: string): Promise<Lead | null> {
  const rows = await db.select().from(leads).where(eq(leads.phone, phone)).limit(1);
  return rows[0] ?? null;
}

export type Kpis = {
  newToday: number;
  qualified: number;
  awaitingRetry: number;
  nextRetryAt: Date | null;
  medianScore: number | null;
  total: number;
};

/** Dashboard tiles, computed at request time. `tz` defines "today". */
export async function getKpis(db: DbOrTx, tz: string, now = new Date()): Promise<Kpis> {
  const p = toLocalParts(now, tz);
  const startOfToday = localToInstant({ year: p.year, month: p.month, day: p.day, hour: 0, minute: 0 }, tz);

  const [newToday, qualified, retry, median, total] = await Promise.all([
    db.select({ n: count() }).from(leads).where(gte(leads.createdAt, startOfToday)),
    db.select({ n: count() }).from(leads).where(eq(leads.status, "qualified")),
    db
      .select({ n: count(), next: sql<Date | null>`min(${leads.nextCallAt})` })
      .from(leads)
      .where(eq(leads.status, "waiting_retry")),
    db
      .select({ median: sql<number | null>`percentile_cont(0.5) within group (order by ${leads.score})` })
      .from(leads)
      .where(isNotNull(leads.score)),
    db.select({ n: count() }).from(leads),
  ]);

  const next = retry[0]?.next;
  return {
    newToday: Number(newToday[0]?.n ?? 0),
    qualified: Number(qualified[0]?.n ?? 0),
    awaitingRetry: Number(retry[0]?.n ?? 0),
    nextRetryAt: next ? new Date(next) : null,
    medianScore: median[0]?.median === null || median[0]?.median === undefined ? null : Math.round(Number(median[0].median)),
    total: Number(total[0]?.n ?? 0),
  };
}

/** Answers for one attempt joined with their criteria, in criteria sort order. */
export async function listAnswersForAttempt(db: DbOrTx, callAttemptId: string): Promise<AnswerWithCriterion[]> {
  const rows = await db
    .select({ answer: qualificationAnswers, criterion: qualificationCriteria })
    .from(qualificationAnswers)
    .innerJoin(qualificationCriteria, eq(qualificationAnswers.criteriaId, qualificationCriteria.id))
    .where(eq(qualificationAnswers.callAttemptId, callAttemptId))
    .orderBy(asc(qualificationCriteria.sortOrder));
  return rows.map((r) => ({ ...r.answer, criterion: r.criterion }));
}
