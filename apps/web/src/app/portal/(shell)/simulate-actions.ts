"use server";

import { PERSONAS, llmResponder, type PersonaKey } from "@solarwave/agent";
import { simulateCall } from "@solarwave/agent/simulate";
import { hasApiKey, modelFor } from "@solarwave/ai";
import { getDb, getLeadById } from "@solarwave/db";
import { scoreAttempt } from "@solarwave/scoring";
import { revalidatePath } from "next/cache";
import { ForbiddenError, requireAdmin } from "@/lib/auth";
import { scoringDeps } from "@/lib/scoring";

export type SimulateActionState = { ok: boolean; message: string; nonce: number };

const REFUSALS: Record<string, string> = {
  lead_not_found: "That lead no longer exists.",
  // Spec section 6: opt-out is terminal and outranks everything, so a simulated
  // call to someone who asked not to be contacted is refused even in a demo.
  opted_out: "This lead opted out. Contact is blocked for all future outreach, simulated included.",
  attempt_in_flight: "A call for this lead is already in flight. Wait for it to finish.",
  no_active_criteria: "No criterion is active, so there is nothing to ask. Activate one first.",
};

/**
 * Runs a simulated call and scores it (design D9).
 *
 * The attempt it writes is real: it goes through the same state machine, the
 * same scoring worker and the same guardrail judge a Twilio call will. That is
 * the point — it exercises the whole pipeline two changes before telephony
 * exists, and the Twilio trial is only about thirty-five calls.
 */
export async function simulateCallAction(
  prev: SimulateActionState,
  formData: FormData,
): Promise<SimulateActionState> {
  const next = (ok: boolean, message: string) => ({ ok, message, nonce: prev.nonce + 1 });

  try {
    await requireAdmin();
  } catch (e) {
    return next(false, e instanceof ForbiddenError ? e.message : "Not allowed");
  }

  const leadId = String(formData.get("leadId") ?? "");
  const personaKey = String(formData.get("persona") ?? "cooperative") as PersonaKey;
  const persona = PERSONAS[personaKey] ?? PERSONAS.cooperative;
  if (!leadId) return next(false, "Missing lead");

  if (!hasApiKey()) {
    return next(false, "No model API key is configured, so a call cannot be simulated.");
  }

  const db = getDb();
  const lead = await getLeadById(db, leadId);
  if (!lead) return next(false, REFUSALS.lead_not_found!);

  const result = await simulateCall({
    db,
    leadId,
    model: modelFor("conversation"),
    respond: llmResponder({
      model: modelFor("persona"),
      persona,
      language: lead.preferredCallLanguage,
    }),
  });

  revalidatePath(`/portal/leads/${leadId}`);
  revalidatePath("/portal/leads");
  revalidatePath("/portal", "layout");

  if (result.status === "refused") return next(false, REFUSALS[result.reason] ?? "Could not simulate this call.");
  if (result.status === "failed") return next(false, `The conversation failed: ${result.message}`);

  // Scoring applies the answered_complete transition itself, from the real
  // score. `simulateCall` deliberately leaves that lead in `calling` rather
  // than inventing a decision (design D3 of scoring-worker).
  const scored = await scoreAttempt(scoringDeps(), result.attemptId);

  revalidatePath(`/portal/leads/${leadId}`);
  revalidatePath("/portal/leads");
  revalidatePath("/portal", "layout");

  const turns = result.transcript.length;
  if (scored.status === "done") {
    return next(
      true,
      `Simulated call with the ${persona.label.toLowerCase()} persona: ${turns} turns, ${result.outcome}, ` +
        `scored ${scored.score} of 100 (${scored.decision}).`,
    );
  }
  if (scored.status === "failed") {
    return next(true, `Call recorded (${turns} turns, ${result.outcome}), but scoring failed: ${scored.message}`);
  }
  return next(true, `Call recorded: ${turns} turns, ${result.outcome}. Not scored: ${scored.reason}.`);
}
