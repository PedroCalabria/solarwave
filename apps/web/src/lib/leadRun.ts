import { getDb, setWorkflowRunId } from "@solarwave/db";
import { start } from "workflow/api";
import { leadWorkflow } from "@/workflows/lead";

/**
 * Starts the durable run for a lead and records its id
 * (lifecycle-and-operations D3, D9).
 *
 * The RUN ID is recorded by the STARTER, not by the workflow — which leaves the
 * workflow writing nothing at all, the cleanest possible statement of D3. It is
 * observability, a link from a lead to its run, and never mutual exclusion:
 * guarding with a compare-and-set across a serverless boundary would mean that
 * losing the race leaves a lead nobody schedules. The real guard already exists
 * and is stronger — `createDispatchedAttempt` locks the lead row and refuses a
 * second attempt inside the transaction that reserves the first, so two runs
 * produce one call and one refusal. A duplicate run is wasted sleep, and wasted
 * sleep is free.
 */
export async function startLeadRun(leadId: string): Promise<string> {
  const run = await start(leadWorkflow, [leadId]);
  await setWorkflowRunId(getDb(), leadId, run.runId);
  return run.runId;
}
