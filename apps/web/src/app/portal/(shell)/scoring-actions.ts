"use server";

import { getDb, markViolationReviewed } from "@solarwave/db";
import { reprocessAttempt, rescoreAttempt, scoreAttempt } from "@solarwave/scoring";
import { revalidatePath } from "next/cache";
import { ForbiddenError, requireEmployee } from "@/lib/auth";
import { scoringDeps } from "@/lib/scoring";

export type ScoringActionState = { ok: boolean; message: string; nonce: number };

function fail(prev: ScoringActionState, message: string): ScoringActionState {
  return { ok: false, message, nonce: prev.nonce + 1 };
}

function done(prev: ScoringActionState, message: string): ScoringActionState {
  return { ok: true, message, nonce: prev.nonce + 1 };
}

function revalidate(leadId?: string) {
  if (leadId) revalidatePath(`/portal/leads/${leadId}`);
  revalidatePath("/portal/leads");
  revalidatePath("/portal/violations");
  revalidatePath("/portal", "layout");
}

async function authorise(prev: ScoringActionState): Promise<ScoringActionState | null> {
  try {
    await requireEmployee();
    return null;
  } catch (e) {
    return fail(prev, e instanceof ForbiddenError ? e.message : "Not allowed");
  }
}

/**
 * The free path: reruns the deterministic engine over the stored answers. No
 * model call, so this is safe to press as often as an employee likes.
 */
export async function rescoreAction(prev: ScoringActionState, formData: FormData): Promise<ScoringActionState> {
  const denied = await authorise(prev);
  if (denied) return denied;

  const attemptId = String(formData.get("attemptId") ?? "");
  const leadId = String(formData.get("leadId") ?? "") || undefined;
  if (!attemptId) return fail(prev, "Missing attempt");

  const result = await rescoreAttempt(getDb(), attemptId);
  revalidate(leadId);

  if (result.status === "done") return done(prev, `Re-scored: ${result.score} of 100, ${result.decision}.`);
  if (result.status === "invalid" && result.reason === "no_answers") {
    return fail(prev, "This attempt has no stored answers to re-score.");
  }
  if (result.status === "invalid" && result.reason === "invalid_criteria") {
    const keys = (result.errors ?? []).map((e) => e.criterionKey).filter(Boolean);
    return fail(prev, `Fix these criteria first: ${keys.join(", ") || "unknown"}.`);
  }
  return fail(prev, "Could not re-score this attempt.");
}

/** The paid path: reads the transcript again with a model. */
export async function reprocessAction(prev: ScoringActionState, formData: FormData): Promise<ScoringActionState> {
  const denied = await authorise(prev);
  if (denied) return denied;

  const attemptId = String(formData.get("attemptId") ?? "");
  const leadId = String(formData.get("leadId") ?? "") || undefined;
  if (!attemptId) return fail(prev, "Missing attempt");

  const result = await reprocessAttempt(scoringDeps(), attemptId);
  revalidate(leadId);

  if (result.status === "done") {
    const audit = result.auditIncomplete ? " The guardrail audit did not finish." : "";
    return done(prev, `Reprocessed: ${result.score} of 100, ${result.decision}.${audit}`);
  }
  if (result.status === "invalid" && result.reason === "no_transcript") {
    return fail(prev, "The transcript was purged, so this attempt cannot be reprocessed.");
  }
  if (result.status === "invalid" && result.reason === "invalid_criteria") {
    const keys = (result.errors ?? []).map((e) => e.criterionKey).filter(Boolean);
    return fail(prev, `Fix these criteria first: ${keys.join(", ") || "unknown"}.`);
  }
  return fail(prev, result.status === "failed" ? `Model call failed: ${result.message}` : "Could not reprocess.");
}

/** Retries a scoring that failed, from the dashboard's pendings list. */
export async function retriggerScoringAction(
  prev: ScoringActionState,
  formData: FormData,
): Promise<ScoringActionState> {
  const denied = await authorise(prev);
  if (denied) return denied;

  const attemptId = String(formData.get("attemptId") ?? "");
  if (!attemptId) return fail(prev, "Missing attempt");

  const result = await scoreAttempt(scoringDeps(), attemptId);
  revalidate(String(formData.get("leadId") ?? "") || undefined);

  if (result.status === "done") return done(prev, `Scored: ${result.score} of 100, ${result.decision}.`);
  if (result.status === "failed") return fail(prev, `Still failing: ${result.message}`);
  return fail(prev, `Cannot score this attempt: ${result.reason.replace(/_/g, " ")}.`);
}

/**
 * Marks a guardrail violation reviewed. A high-severity violation blocks any
 * further call to the lead until this happens (design D8b).
 */
export async function reviewViolationAction(
  prev: ScoringActionState,
  formData: FormData,
): Promise<ScoringActionState> {
  let actorId: string;
  try {
    actorId = (await requireEmployee()).id;
  } catch (e) {
    return fail(prev, e instanceof ForbiddenError ? e.message : "Not allowed");
  }

  const violationId = String(formData.get("violationId") ?? "");
  if (!violationId) return fail(prev, "Missing violation");

  await markViolationReviewed(getDb(), violationId, actorId);
  revalidate(String(formData.get("leadId") ?? "") || undefined);
  return done(prev, "Marked reviewed.");
}
