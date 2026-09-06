"use server";

import { getDb, getLeadById } from "@solarwave/db";
import { dispatchCall } from "@solarwave/voice/dispatch";
import { revalidatePath } from "next/cache";
import { ForbiddenError, requireAdmin } from "@/lib/auth";

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
      const detail = result.reason === "not_configured" && result.detail ? ` Missing: ${result.detail}.` : "";
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
