"use server";

import { isTerminal } from "@solarwave/core";
import { getDb, getLeadById } from "@solarwave/db";
import { dispatchCall } from "@solarwave/voice/dispatch";
import { revalidatePath } from "next/cache";
import { ForbiddenError, requireAdmin } from "@/lib/auth";
import { startLeadRun } from "@/lib/leadRun";

export type CallActionState = { ok: boolean; message: string; nonce: number };

/**
 * Every refusal, in language an employee can act on (telephony-dispatch spec).
 *
 * A refusal is not a failure: each of these is the system declining to dial for
 * a reason the operator can either fix or accept.
 */
const REFUSALS: Record<string, string> = {
  lead_not_found: "That lead no longer exists.",
  opted_out: "This lead opted out. Contact is blocked for all future outreach.",
  attempt_in_flight: "A call for this lead is already in flight. Wait for it to finish.",
  attempt_cap_reached: "This lead has used every attempt allowed.",
  blocked_by_violation:
    "An unreviewed high-severity guardrail violation is blocking outreach. Review it on the Guardrails page first.",
  outside_call_window: "It is outside the 08:00–22:00 window in this lead's timezone.",
  no_active_criteria: "No criterion is active, so there is nothing to ask. Activate one first.",
  not_configured: "Telephony is not configured, so no call can be placed.",
  auto_dispatch_disabled:
    "Automatic dispatch is switched off, so the scheduler placed no call. Turn it on under Operations.",
  budget_exhausted:
    "The call budget is spent. Raise it under Operations, or wait for the window to roll.",
};

/**
 * Places a REAL call to this lead (design D5).
 *
 * The same `dispatchCall` the internal route runs, so the admin path and the
 * workflow path in change 5 cannot drift. Admin-only: this one dials a
 * telephone, and the trial allowance is 75 minutes.
 */
export async function callNowAction(prev: CallActionState, formData: FormData): Promise<CallActionState> {
  const next = (ok: boolean, message: string) => ({ ok, message, nonce: prev.nonce + 1 });

  try {
    await requireAdmin();
  } catch (e) {
    return next(false, e instanceof ForbiddenError ? e.message : "Not allowed");
  }

  const leadId = String(formData.get("leadId") ?? "");
  if (!leadId) return next(false, "Missing lead");

  const db = getDb();
  const lead = await getLeadById(db, leadId);
  if (!lead) return next(false, REFUSALS.lead_not_found!);

  const result = await dispatchCall({ db, leadId });

  revalidatePath(`/portal/leads/${leadId}`);
  revalidatePath("/portal/leads");
  revalidatePath("/portal", "layout");

  switch (result.status) {
    case "refused": {
      const detail =
        result.reason === "not_configured" && result.detail
          ? ` Missing: ${result.detail}.`
          : // Which budget, and how far past it. "Budget exhausted" on its own
            // sends an operator to the database to find out.
            result.reason === "budget_exhausted" && result.detail
            ? ` (${result.detail})`
            : "";
      return next(false, (REFUSALS[result.reason] ?? "Could not place this call.") + detail);
    }
    case "failed":
      return next(
        false,
        `The provider refused the call: ${result.message}` +
          (result.retryScheduled ? " A retry has been scheduled." : ""),
      );
    case "dispatched":
      return next(
        true,
        `Calling ${lead.phone} now — attempt ${result.attemptNumber}. The result lands here when the call ends.`,
      );
  }
}

/**
 * Starts the durable run for a lead that has none
 * (lifecycle-and-operations D9, `call-orchestration` spec).
 *
 * Intake starts a run for every lead it creates, so this exists for the ones
 * that predate the scheduler and for a run that was cancelled. It places no
 * call itself: the run re-reads the lead and obeys every refusal, the
 * automatic-dispatch switch included.
 */
export async function startRunAction(prev: CallActionState, formData: FormData): Promise<CallActionState> {
  const next = (ok: boolean, message: string) => ({ ok, message, nonce: prev.nonce + 1 });

  try {
    await requireAdmin();
  } catch (e) {
    return next(false, e instanceof ForbiddenError ? e.message : "Not allowed");
  }

  const leadId = String(formData.get("leadId") ?? "");
  if (!leadId) return next(false, "Missing lead");

  const db = getDb();
  const lead = await getLeadById(db, leadId);
  if (!lead) return next(false, REFUSALS.lead_not_found!);
  // Spec section 6: never schedule anything for an opted-out lead, not even a
  // run that would refuse to dial. The refusal is clearer here than downstream.
  if (lead.status === "opt_out") return next(false, REFUSALS.opted_out!);
  if (isTerminal(lead.status)) return next(false, "This lead has reached a final status. There is nothing to schedule.");

  try {
    const runId = await startLeadRun(leadId);
    revalidatePath(`/portal/leads/${leadId}`);
    return next(true, `Scheduling run started (${runId}). It calls at the lead's next scheduled time.`);
  } catch (error) {
    return next(false, `Could not start the run: ${error instanceof Error ? error.message : String(error)}`);
  }
}
