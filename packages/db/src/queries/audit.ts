import { desc, eq, gt } from "drizzle-orm";
import type { DbOrTx } from "../client";
import { criteriaAuditLog, employees, qualificationCriteria, type AuditEntry } from "../schema";

export type NewAuditEntry = {
  criteriaId: string | null;
  changedBy: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
};

export async function appendAudit(db: DbOrTx, entries: NewAuditEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await db.insert(criteriaAuditLog).values(entries);
}

export type AuditRow = AuditEntry & {
  employeeName: string | null;
  criterionLabel: string | null;
  criterionKey: string | null;
};

/** Newest first, joined with the employee and the criterion (null for settings). */
export async function listAudit(db: DbOrTx, limit = 200): Promise<AuditRow[]> {
  const rows = await db
    .select({
      entry: criteriaAuditLog,
      employeeName: employees.name,
      criterionLabel: qualificationCriteria.label,
      criterionKey: qualificationCriteria.key,
    })
    .from(criteriaAuditLog)
    .leftJoin(employees, eq(criteriaAuditLog.changedBy, employees.id))
    .leftJoin(qualificationCriteria, eq(criteriaAuditLog.criteriaId, qualificationCriteria.id))
    .orderBy(desc(criteriaAuditLog.changedAt))
    .limit(limit);
  return rows.map((r) => ({
    ...r.entry,
    employeeName: r.employeeName,
    criterionLabel: r.criterionLabel,
    criterionKey: r.criterionKey,
  }));
}

export async function countAudit(db: DbOrTx): Promise<number> {
  const rows = await db.select({ id: criteriaAuditLog.id }).from(criteriaAuditLog);
  return rows.length;
}

export type AuditChangeRow = { field: string; oldValue: string | null; newValue: string | null; changedAt: Date };

/**
 * Criteria and settings changes newer than a point in time, newest first. The
 * recomputation classifier reads these to decide whether a stale score needs a
 * free re-score or a model call.
 */
export async function auditChangesSince(db: DbOrTx, since: Date): Promise<AuditChangeRow[]> {
  return db
    .select({
      field: criteriaAuditLog.field,
      oldValue: criteriaAuditLog.oldValue,
      newValue: criteriaAuditLog.newValue,
      changedAt: criteriaAuditLog.changedAt,
    })
    .from(criteriaAuditLog)
    .where(gt(criteriaAuditLog.changedAt, since))
    .orderBy(desc(criteriaAuditLog.changedAt));
}

/** When criteria or settings last changed at all. Null when never. */
export async function latestCriteriaChangeAt(db: DbOrTx): Promise<Date | null> {
  const [row] = await db
    .select({ changedAt: criteriaAuditLog.changedAt })
    .from(criteriaAuditLog)
    .orderBy(desc(criteriaAuditLog.changedAt))
    .limit(1);
  return row?.changedAt ?? null;
}
