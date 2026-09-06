import { getDb } from "@solarwave/db";
import { dispatchCall } from "@solarwave/voice/dispatch";
import { timingSafeEqual } from "node:crypto";

/**
 * Places a real call (design D5).
 *
 * The same `dispatchCall` the admin action runs, behind a shared secret, so the
 * workflow in change 5 has an entry point that already exists and is already
 * exercised. This change never calls it on a schedule.
 */
export async function POST(request: Request) {
  if (!authorised(request)) {
    // Rejected before the body is read.
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }

  let leadId: unknown;
  try {
    ({ leadId } = (await request.json()) as { leadId?: unknown });
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof leadId !== "string" || leadId.trim() === "") {
    return Response.json({ error: "leadId is required" }, { status: 400 });
  }

  const result = await dispatchCall({ db: getDb(), leadId });
  switch (result.status) {
    case "dispatched":
      return Response.json({
        status: "dispatched",
        callSid: result.callSid,
        attemptId: result.attempt.id,
        attemptNumber: result.attemptNumber,
      });
    case "refused":
      return Response.json({ status: "refused", reason: result.reason, detail: result.detail }, { status: 409 });
    case "failed":
      return Response.json(
        { status: "failed", message: result.message, retryScheduled: result.retryScheduled },
        { status: 502 },
      );
  }
}

function authorised(request: Request): boolean {
  const expected = process.env.CALL_WORKER_SECRET?.trim();
  if (!expected) return false;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
