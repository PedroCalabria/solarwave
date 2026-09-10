import { isAuthorisedCronCall, runMaintenance } from "@/lib/maintenance";

/**
 * The daily maintenance job (lifecycle-and-operations D7, `scheduled-maintenance`).
 *
 * ONE route for every periodic task, because Vercel Hobby runs a cron at most
 * once a day and these four want that same cadence. It answers GET as well as
 * POST: Vercel's scheduler issues a GET, and POST is what a person uses to run
 * it by hand.
 *
 * Always 200 when authorised, even when a task failed. The response body says
 * which — a non-2xx would make the scheduler retry the tasks that SUCCEEDED,
 * and one of them dispatches telephone calls.
 */
async function handle(request: Request) {
  if (!isAuthorisedCronCall(request)) {
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }

  const reports = await runMaintenance();
  return Response.json({
    ok: reports.every((r) => r.ok),
    tasks: reports,
  });
}

export const GET = handle;
export const POST = handle;
