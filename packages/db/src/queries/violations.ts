import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db, DbOrTx } from "../client";
import { callAttempts, employees, guardrailViolations, leads, type GuardrailViolation } from "../schema";

export type NewViolation = {
  callAttemptId: string;
  guardrail: string;
  severity: string;
  evidence: string | null;
};

/**
 * Replaces the findings for an attempt. The judge is re-runnable, so appending
 * would accumulate duplicates of the same violation across runs. Rows already
 * reviewed by a human are kept: their review is a human decision that a re-run
 * must not erase.
 */
export async function replaceViolations(db: Db, attemptId: string, findings: NewViolation[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(guardrailViolations)
      .where(and(eq(guardrailViolations.callAttemptId, attemptId), isNull(guardrailViolations.reviewedAt)));

    const reviewed = await tx
      .select({ guardrail: guardrailViolations.guardrail })
      .from(guardrailViolations)
      .where(eq(guardrailViolations.callAttemptId, attemptId));
    const alreadyReviewed = new Set(reviewed.map((r) => r.guardrail));

    const fresh = findings.filter((f) => !alreadyReviewed.has(f.guardrail));
    if (fresh.length > 0) await tx.insert(guardrailViolations).values(fresh);
  });
}

export type ViolationRow = GuardrailViolation & {
  leadId: string;
  leadName: string;
  attemptNumber: number;
  reviewerName: string | null;
};

export async function listViolations(db: DbOrTx, limit = 200): Promise<ViolationRow[]> {
  const rows = await db
    .select({
      violation: guardrailViolations,
      leadId: leads.id,
      leadName: leads.name,
      attemptNumber: callAttempts.attemptNumber,
      reviewerName: employees.name,
    })
    .from(guardrailViolations)
    .innerJoin(callAttempts, eq(guardrailViolations.callAttemptId, callAttempts.id))
    .innerJoin(leads, eq(callAttempts.leadId, leads.id))
    .leftJoin(employees, eq(guardrailViolations.reviewedBy, employees.id))
    .orderBy(desc(guardrailViolations.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r.violation,
    leadId: r.leadId,
    leadName: r.leadName,
    attemptNumber: r.attemptNumber,
    reviewerName: r.reviewerName,
  }));
}

export async function markViolationReviewed(db: DbOrTx, violationId: string, actorId: string): Promise<void> {
  await db
    .update(guardrailViolations)
    .set({ reviewedAt: new Date(), reviewedBy: actorId })
    .where(eq(guardrailViolations.id, violationId));
}

/**
 * A lead blocked from further outreach: an unreviewed high-severity violation
 * is a hard stop that the scheduler must honour before dispatching (design D8b).
 */
export async function hasBlockingViolation(db: DbOrTx, leadId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: guardrailViolations.id })
    .from(guardrailViolations)
    .innerJoin(callAttempts, eq(guardrailViolations.callAttemptId, callAttempts.id))
    .where(
      and(eq(callAttempts.leadId, leadId), eq(guardrailViolations.severity, "high"), isNull(guardrailViolations.reviewedAt)),
    )
    .limit(1);
  return Boolean(row);
}

export async function countUnreviewedViolations(db: DbOrTx): Promise<number> {
  const rows = await db
    .select({ id: guardrailViolations.id })
    .from(guardrailViolations)
    .where(isNull(guardrailViolations.reviewedAt));
  return rows.length;
}
