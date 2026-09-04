import { isTerminal, transition, type LeadEvent, type TransitionError } from "@solarwave/core";
import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { leads, type Lead } from "../schema";

export type TransitionPatch = Partial<
  Pick<Lead, "nextCallAt" | "score" | "qualificationReason" | "icebreaker" | "workflowRunId">
>;

export type ApplyTransitionResult =
  | { ok: true; lead: Lead; previous: Lead["status"] }
  | { ok: false; error: TransitionError | { code: "not_found" } };

/**
 * Applies a lifecycle event to a lead inside a transaction with the row locked
 * (`SELECT ... FOR UPDATE`), so concurrent writers serialise and a losing
 * write is rejected by the pure transition table instead of overwriting.
 */
export async function applyLeadTransition(
  db: Db,
  leadId: string,
  event: LeadEvent,
  patch: TransitionPatch = {},
): Promise<ApplyTransitionResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(leads).where(eq(leads.id, leadId)).for("update");
    if (!current) return { ok: false, error: { code: "not_found" } };

    const next = transition(current.status, event);
    if (!next.ok) return { ok: false, error: next.error };

    const now = new Date();
    const set: Partial<Lead> = { ...patch, status: next.value, updatedAt: now };

    if (next.value === "opt_out") {
      set.optOutAt = now;
      set.nextCallAt = null;
    } else if (isTerminal(next.value)) {
      set.nextCallAt = null;
    }
    if (event.type === "attempt_ended") set.attemptCount = event.attemptCount;
    if (event.type === "dispatch") set.nextCallAt = null;

    const [updated] = await tx.update(leads).set(set).where(eq(leads.id, leadId)).returning();
    return { ok: true, lead: updated!, previous: current.status };
  });
}
