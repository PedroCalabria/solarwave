import { scoreAttempt } from "@solarwave/scoring";
import { isAuthorisedWorkerCall, scoringDeps } from "@/lib/scoring";

/**
 * Scores one call attempt (spec section 4.6).
 *
 * This change does not build `leadWorkflow`; the workflow step in change 5 will
 * call `scoreAttempt` directly. The route exists so the same path can be driven
 * by hand and by tests today, before any telephony exists.
 */
export async function POST(request: Request) {
  if (!isAuthorisedWorkerCall(request)) {
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }

  let attemptId: unknown;
  try {
    ({ attemptId } = (await request.json()) as { attemptId?: unknown });
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (typeof attemptId !== "string" || attemptId.trim() === "") {
    return Response.json({ error: "attemptId is required" }, { status: 400 });
  }

  const outcome = await scoreAttempt(scoringDeps(), attemptId);

  switch (outcome.status) {
    case "done":
      return Response.json({
        scoringStatus: "done",
        score: outcome.score,
        decision: outcome.decision,
        leadStatus: outcome.leadStatus,
        findings: outcome.findings.map((f) => ({ guardrail: f.guardrail, severity: f.severity })),
        auditIncomplete: outcome.auditIncomplete,
      });
    case "invalid":
      // Not a failure of the run: the attempt cannot be scored as configured,
      // so `scoring_status` stays `pending` and fixing the cause makes it work.
      return Response.json(
        { scoringStatus: "pending", reason: outcome.reason, errors: outcome.errors ?? [] },
        { status: outcome.reason === "not_found" ? 404 : 422 },
      );
    case "failed":
      return Response.json({ scoringStatus: "failed", message: outcome.message }, { status: 502 });
  }
}
