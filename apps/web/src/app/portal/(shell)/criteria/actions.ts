"use server";

import { lintQuestions, type LintWarning } from "@solarwave/agent";
import { hasApiKey, modelFor } from "@solarwave/ai";
import { CRITERION_TYPES, type CriterionType } from "@solarwave/core";
import {
  SETTING_KEYS,
  createCriterion,
  getDb,
  setCriterionActive,
  softDeleteCriterion,
  updateCriterion,
  updateSetting,
  type CriterionInput,
} from "@solarwave/db";
import { revalidatePath } from "next/cache";
import { ForbiddenError, requireAdmin } from "@/lib/auth";
import type { ActionState } from "./state";

function revalidate() {
  revalidatePath("/portal/criteria");
  revalidatePath("/portal/audit");
  revalidatePath("/portal", "layout");
}

function fail(prev: ActionState, message: string, fieldErrors: Record<string, string> = {}): ActionState {
  return { ok: false, message, fieldErrors, warnings: [], nonce: prev.nonce + 1 };
}

function parseCriterionForm(formData: FormData): { input: CriterionInput; id: string | null } {
  const typeRaw = String(formData.get("type") ?? "boolean");
  const type: CriterionType = (CRITERION_TYPES as readonly string[]).includes(typeRaw) ? (typeRaw as CriterionType) : "boolean";
  const expected = String(formData.get("expectedValue") ?? "").trim();
  // The vocabulary only exists for enum criteria; anything else must send null
  // or validation rejects it (design D5).
  const options = String(formData.get("options") ?? "").trim();
  return {
    id: String(formData.get("id") ?? "") || null,
    input: {
      key: String(formData.get("key") ?? "").trim().toLowerCase(),
      label: String(formData.get("label") ?? "").trim(),
      questionPt: String(formData.get("questionPt") ?? "").trim(),
      questionEn: String(formData.get("questionEn") ?? "").trim(),
      type,
      options: type === "enum" && options !== "" ? options : null,
      expectedValue: type === "free_text" || expected === "" ? null : expected,
      weight: Number.parseInt(String(formData.get("weight") ?? ""), 10),
      blocking: formData.get("blocking") === "on",
      active: formData.get("active") === "on",
    },
  };
}

export async function saveCriterionAction(prev: ActionState, formData: FormData): Promise<ActionState> {
  let actorId: string;
  try {
    actorId = (await requireAdmin()).id;
  } catch (e) {
    return fail(prev, e instanceof ForbiddenError ? e.message : "Not allowed");
  }

  const { id, input } = parseCriterionForm(formData);
  if (Number.isNaN(input.weight)) input.weight = -1; // fails validation with a field error

  const result = await getDb().transaction(async (tx) =>
    id ? updateCriterion(tx, id, input, actorId) : createCriterion(tx, input, actorId),
  );

  if (!result.ok) {
    const fieldErrors: Record<string, string> = {};
    for (const e of result.errors) fieldErrors[e.field] = e.message;
    return fail(prev, "Please fix the highlighted fields.", fieldErrors);
  }

  revalidate();
  // No lint here on purpose: the save must not wait on a model, and a warning
  // must not be able to reject an admin's work (design D10). The client calls
  // `lintQuestionAction` separately once this returns.
  return {
    ok: true,
    warnings: [],
    message: id
      ? result.changedFields.length
        ? `Saved. Audited fields: ${result.changedFields.join(", ")}.`
        : "Saved. Nothing changed."
      : `Created “${result.criterion.label}”.`,
    fieldErrors: {},
    nonce: prev.nonce + 1,
  };
}

export async function toggleCriterionAction(id: string, active: boolean): Promise<{ ok: boolean; message: string | null }> {
  try {
    const actor = await requireAdmin();
    const updated = await getDb().transaction((tx) => setCriterionActive(tx, id, active, actor.id));
    if (!updated) return { ok: false, message: "Criterion not found." };
    revalidate();
    return { ok: true, message: null };
  } catch (e) {
    return { ok: false, message: e instanceof ForbiddenError ? e.message : "Could not update the criterion." };
  }
}

export async function deleteCriterionAction(id: string): Promise<{ ok: boolean; message: string | null }> {
  try {
    const actor = await requireAdmin();
    const removed = await getDb().transaction((tx) => softDeleteCriterion(tx, id, actor.id));
    if (!removed) return { ok: false, message: "Criterion not found." };
    revalidate();
    return { ok: true, message: null };
  } catch (e) {
    return { ok: false, message: e instanceof ForbiddenError ? e.message : "Could not delete the criterion." };
  }
}

export async function saveSettingsAction(prev: ActionState, formData: FormData): Promise<ActionState> {
  let actorId: string;
  try {
    actorId = (await requireAdmin()).id;
  } catch (e) {
    return fail(prev, e instanceof ForbiddenError ? e.message : "Not allowed");
  }

  const threshold = Number(String(formData.get("handoffThreshold") ?? ""));
  const share = Number(String(formData.get("minAnsweredWeightShare") ?? "")) / 100;

  const outcome = await getDb().transaction(async (tx) => {
    const a = await updateSetting(tx, SETTING_KEYS.handoffThreshold, threshold, actorId);
    if (!a.ok) return a;
    const b = await updateSetting(tx, SETTING_KEYS.minAnsweredWeightShare, Math.round(share * 1000) / 1000, actorId);
    if (!b.ok) throw Object.assign(new Error("rollback"), { setting: b.error });
    return b;
  }).catch((e: unknown) => {
    const err = (e as { setting?: { field: string; message: string } }).setting;
    return err ? { ok: false as const, error: err } : Promise.reject(e);
  });

  if (!outcome.ok) return fail(prev, "Please fix the highlighted fields.", { [outcome.error.field]: outcome.error.message });

  revalidate();
  return { ok: true, message: "Settings saved.", fieldErrors: {}, warnings: [], nonce: prev.nonce + 1 };
}

/**
 * The advisory question check (design D10).
 *
 * Deliberately its own action rather than part of `saveCriterionAction`: a
 * model call inside a form submission makes every criterion edit feel broken
 * when the free tier throttles, and makes the portal unusable without an API
 * key — which the seed path and the integration tests deliberately support.
 * The client calls this after a successful save, and the "Check question"
 * control calls it before one.
 *
 * It fails open in every direction: `lintQuestions` never throws and returns no
 * warnings on any model failure, and a caller who is not an admin simply gets
 * nothing rather than an error.
 */
export async function lintQuestionAction(input: {
  label: string;
  questionPt: string;
  questionEn: string;
}): Promise<{ warnings: LintWarning[] }> {
  try {
    await requireAdmin();
  } catch {
    return { warnings: [] };
  }

  if (!hasApiKey()) return { warnings: [] };

  const warnings = await lintQuestions({
    model: modelFor("linter"),
    label: input.label,
    questionPt: input.questionPt,
    questionEn: input.questionEn,
  });

  return { warnings };
}
