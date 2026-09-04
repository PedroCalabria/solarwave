import { parseExpectedValue, type CriterionType } from "@solarwave/core";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import type { DbOrTx } from "../client";
import { qualificationCriteria, type Criterion } from "../schema";
import { appendAudit, type NewAuditEntry } from "./audit";

const KEY_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

export type CriterionInput = {
  key: string;
  label: string;
  questionPt: string;
  questionEn: string;
  type: CriterionType;
  expectedValue: string | null;
  weight: number;
  blocking: boolean;
  active: boolean;
  sortOrder?: number;
};

export type CriterionFieldError = { field: keyof CriterionInput; message: string };

export function validateCriterionInput(input: CriterionInput): CriterionFieldError[] {
  const errors: CriterionFieldError[] = [];
  if (!KEY_PATTERN.test(input.key)) {
    errors.push({ field: "key", message: "key must be snake_case: lowercase letters, digits and underscores" });
  }
  if (input.label.trim().length < 2) errors.push({ field: "label", message: "label is required" });
  if (input.questionPt.trim().length < 5) errors.push({ field: "questionPt", message: "Portuguese question is required" });
  if (input.questionEn.trim().length < 5) errors.push({ field: "questionEn", message: "English question is required" });
  if (!Number.isInteger(input.weight) || input.weight < 0 || input.weight > 100) {
    errors.push({ field: "weight", message: "weight must be an integer between 0 and 100" });
  }
  const rule = parseExpectedValue(input.type, input.expectedValue);
  if (!rule.ok) errors.push({ field: "expectedValue", message: rule.error.message });
  return errors;
}

/** Criteria that are not soft-deleted, in display order. */
export async function listCriteria(db: DbOrTx): Promise<Criterion[]> {
  return db
    .select()
    .from(qualificationCriteria)
    .where(isNull(qualificationCriteria.deletedAt))
    .orderBy(asc(qualificationCriteria.sortOrder), asc(qualificationCriteria.createdAt));
}

/** Active, not deleted, in display order: what the agent asks and the engine scores. */
export async function listActiveCriteria(db: DbOrTx): Promise<Criterion[]> {
  return db
    .select()
    .from(qualificationCriteria)
    .where(and(isNull(qualificationCriteria.deletedAt), eq(qualificationCriteria.active, true)))
    .orderBy(asc(qualificationCriteria.sortOrder), asc(qualificationCriteria.createdAt));
}

export async function getCriterionById(db: DbOrTx, id: string): Promise<Criterion | null> {
  const rows = await db.select().from(qualificationCriteria).where(eq(qualificationCriteria.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getCriterionByKey(db: DbOrTx, key: string): Promise<Criterion | null> {
  const rows = await db.select().from(qualificationCriteria).where(eq(qualificationCriteria.key, key)).limit(1);
  return rows[0] ?? null;
}

export type CriterionMutationResult =
  | { ok: true; criterion: Criterion; changedFields: string[] }
  | { ok: false; errors: CriterionFieldError[] };

async function keyTaken(tx: DbOrTx, key: string, exceptId?: string): Promise<boolean> {
  const rows = await tx
    .select({ id: qualificationCriteria.id })
    .from(qualificationCriteria)
    .where(exceptId ? and(eq(qualificationCriteria.key, key), ne(qualificationCriteria.id, exceptId)) : eq(qualificationCriteria.key, key))
    .limit(1);
  return rows.length > 0;
}

/** Creates a criterion and its "created" audit row. Call inside a transaction. */
export async function createCriterion(tx: DbOrTx, input: CriterionInput, actorId: string): Promise<CriterionMutationResult> {
  const errors = validateCriterionInput(input);
  if (errors.length === 0 && (await keyTaken(tx, input.key))) {
    errors.push({ field: "key", message: "a criterion with this key already exists" });
  }
  if (errors.length > 0) return { ok: false, errors };

  const [criterion] = await tx
    .insert(qualificationCriteria)
    .values({ ...input, expectedValue: input.type === "free_text" ? null : input.expectedValue, updatedBy: actorId })
    .returning();

  await appendAudit(tx, [
    {
      criteriaId: criterion!.id,
      changedBy: actorId,
      field: "created",
      oldValue: null,
      newValue: `${criterion!.key}: ${criterion!.type}, weight ${criterion!.weight}${criterion!.blocking ? ", blocking" : ""}`,
    },
  ]);
  return { ok: true, criterion: criterion!, changedFields: ["created"] };
}

const AUDITED_FIELDS = [
  "key",
  "label",
  "questionPt",
  "questionEn",
  "type",
  "expectedValue",
  "weight",
  "blocking",
  "active",
  "sortOrder",
] as const satisfies readonly (keyof CriterionInput)[];

function fmt(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

/** Updates a criterion and writes one audit row per changed field, in the same transaction. */
export async function updateCriterion(
  tx: DbOrTx,
  id: string,
  input: CriterionInput,
  actorId: string,
): Promise<CriterionMutationResult> {
  const existing = await getCriterionById(tx, id);
  if (!existing || existing.deletedAt) return { ok: false, errors: [{ field: "key", message: "criterion not found" }] };

  const errors = validateCriterionInput(input);
  if (errors.length === 0 && input.key !== existing.key && (await keyTaken(tx, input.key, id))) {
    errors.push({ field: "key", message: "a criterion with this key already exists" });
  }
  if (errors.length > 0) return { ok: false, errors };

  const next = { ...input, expectedValue: input.type === "free_text" ? null : input.expectedValue };
  const auditRows: NewAuditEntry[] = [];
  for (const field of AUDITED_FIELDS) {
    const before = existing[field];
    const after = next[field] ?? (field === "sortOrder" ? existing.sortOrder : null);
    if (fmt(before) !== fmt(after)) {
      auditRows.push({ criteriaId: id, changedBy: actorId, field, oldValue: fmt(before), newValue: fmt(after) });
    }
  }

  const [criterion] = await tx
    .update(qualificationCriteria)
    .set({ ...next, sortOrder: next.sortOrder ?? existing.sortOrder, updatedBy: actorId, updatedAt: new Date() })
    .where(eq(qualificationCriteria.id, id))
    .returning();

  await appendAudit(tx, auditRows);
  return { ok: true, criterion: criterion!, changedFields: auditRows.map((r) => r.field) };
}

export async function setCriterionActive(tx: DbOrTx, id: string, active: boolean, actorId: string): Promise<Criterion | null> {
  const existing = await getCriterionById(tx, id);
  if (!existing || existing.deletedAt) return null;
  if (existing.active === active) return existing;

  const [criterion] = await tx
    .update(qualificationCriteria)
    .set({ active, updatedBy: actorId, updatedAt: new Date() })
    .where(eq(qualificationCriteria.id, id))
    .returning();
  await appendAudit(tx, [
    { criteriaId: id, changedBy: actorId, field: "active", oldValue: String(existing.active), newValue: String(active) },
  ]);
  return criterion!;
}

/** Soft delete: answers and audit rows stay linked; the criterion leaves every list. */
export async function softDeleteCriterion(tx: DbOrTx, id: string, actorId: string): Promise<boolean> {
  const existing = await getCriterionById(tx, id);
  if (!existing || existing.deletedAt) return false;

  await tx
    .update(qualificationCriteria)
    .set({ deletedAt: new Date(), active: false, updatedBy: actorId, updatedAt: new Date() })
    .where(eq(qualificationCriteria.id, id));
  await appendAudit(tx, [
    { criteriaId: id, changedBy: actorId, field: "deleted", oldValue: existing.key, newValue: null },
  ]);
  return true;
}
