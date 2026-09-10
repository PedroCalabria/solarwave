import {
  getDb,
  keepAlivePing,
  listOverdueLeads,
  listPendingScoring,
  purgeExpiredTranscripts,
  reconcileStaleAttempts,
} from "@solarwave/db";
import { scoreAttempt } from "@solarwave/scoring";
import { dispatchCall } from "@solarwave/voice/dispatch";
import { scoringDeps } from "@/lib/scoring";

/**
 * The daily maintenance run (lifecycle-and-operations D7).
 *
 * One job doing four things, each attempted INDEPENDENTLY. A failure in one
 * must not stop the rest: the purge and the sweep have nothing to do with each
 * other, and a change that let one break the others would turn a small problem
 * into a silent stop of everything periodic.
 *
 * Kept out of the route handler so it can be tested without HTTP.
 */

export type TaskReport = { task: string; ok: boolean; detail: string };

/** Vercel cron authenticates with a bearer token it is given; a secret is required. */
export function isAuthorisedCronCall(request: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  // No secret configured means no access, never open access. A maintenance run
  // dispatches calls, and an unauthenticated route that dispatches calls on a
  // public production domain is the failure this guards.
  if (!expected) return false;

  const header = request.headers.get("authorization")?.trim();
  if (header === `Bearer ${expected}`) return true;
  return request.headers.get("x-cron-secret")?.trim() === expected;
}

async function attempt(task: string, run: () => Promise<string>): Promise<TaskReport> {
  try {
    return { task, ok: true, detail: await run() };
  } catch (error) {
    return { task, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export type MaintenanceOptions = {
  now?: Date;
  /** How far past its scheduled time a lead must be before the sweep takes it. */
  overdueMarginMs?: number;
  /** Hard ceiling on calls one run may place, on top of the dispatch budgets. */
  maxSweepDispatches?: number;
};

export async function runMaintenance(options: MaintenanceOptions = {}): Promise<TaskReport[]> {
  const db = getDb();
  const now = options.now ?? new Date();
  const reports: TaskReport[] = [];

  // 1. Spec section 10: twelve months, then the conversation goes. The attempt,
  //    its outcome and its answers stay.
  reports.push(
    await attempt("purge_transcripts", async () => {
      const { purged } = await purgeExpiredTranscripts(db, now);
      return `${purged} transcript(s) purged`;
    }),
  );

  // 2. The backstop for a status callback that never arrived. Its only other
  //    caller is a dispatch to the same lead — unreachable for a lead this
  //    condition has frozen in `calling`.
  reports.push(
    await attempt("reconcile_attempts", async () => {
      const maxCallSeconds = Number(process.env.VOICE_MAX_CALL_SECONDS ?? 180);
      const { closed } = await reconcileStaleAttempts(db, {
        maxCallSeconds: Number.isFinite(maxCallSeconds) && maxCallSeconds > 0 ? maxCallSeconds : 180,
        now,
      });
      return `${closed.length} stale attempt(s) closed`;
    }),
  );

  // 3. A scoring run that threw leaves an attempt closed and permanently
  //    unscored; only the portal's manual button recovers it today.
  reports.push(
    await attempt("recover_scoring", async () => {
      const pending = await listPendingScoring(db);
      let recovered = 0;
      for (const attemptId of pending) {
        const scored = await scoreAttempt(scoringDeps(), attemptId);
        if (scored.status === "done") recovered += 1;
      }
      return `${recovered}/${pending.length} attempt(s) scored`;
    }),
  );

  // 4. The degradation path of D11, and a backstop even when the run is
  //    healthy. Every dispatch here goes through the same refusals and the same
  //    budgets as every other one.
  reports.push(
    await attempt("sweep_overdue", async () => {
      const overdue = await listOverdueLeads(db, { now, ...(options.overdueMarginMs !== undefined ? { marginMs: options.overdueMarginMs } : {}) });
      const ceiling = options.maxSweepDispatches ?? 5;

      let dispatched = 0;
      const refusals: string[] = [];
      for (const leadId of overdue) {
        if (dispatched >= ceiling) break;
        const result = await dispatchCall({ db, leadId, origin: "run", now });
        if (result.status === "dispatched") dispatched += 1;
        else if (result.status === "refused") refusals.push(result.reason);
        else refusals.push("failed");
      }
      return `${overdue.length} overdue, ${dispatched} dispatched${
        refusals.length > 0 ? `, refused: ${[...new Set(refusals)].join(", ")}` : ""
      }`;
    }),
  );

  // 5. Not a task, a guarantee: on a day when everything above finds nothing,
  //    the database must still have been touched.
  reports.push(
    await attempt("keep_alive", async () => {
      const { at } = await keepAlivePing(db);
      return `database reachable at ${at.toISOString()}`;
    }),
  );

  return reports;
}
