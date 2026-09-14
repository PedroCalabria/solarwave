import { isWithinCallWindow, scheduleRetry } from "@solarwave/core";
import {
  attachCallSid,
  createDispatchedAttempt,
  finishAttempt,
  getLeadById,
  getOperationsSettings,
  listActiveCriteria,
  reconcileStaleAttempts,
  type CallAttempt,
  type Db,
  type DispatchOrigin,
  type Lead,
} from "@solarwave/db";
import twilio from "twilio";
import { mintCallToken } from "./callToken";
import { readVoiceConfig, type VoiceConfig } from "./config";

/**
 * Placing a real call (voice-bridge design D5).
 *
 * Server-only, and behind a subpath rather than the barrel: this is the one
 * module in `packages/voice` that touches `@solarwave/db`, and through it the
 * postgres driver. A Client Component that reaches it drags `fs`, `net` and
 * `tls` into the browser bundle and the build fails — which is exactly what
 * happened to `@solarwave/agent` in change 3.
 */

/** Comfortably longer than any call, so a late status callback still verifies. */
const WEBHOOK_TOKEN_TTL_MS = 60 * 60 * 1000;

export type DispatchRefusal =
  | "lead_not_found"
  | "opted_out"
  | "attempt_in_flight"
  | "attempt_cap_reached"
  | "blocked_by_violation"
  | "outside_call_window"
  | "no_active_criteria"
  | "not_configured"
  /** The scheduler asked while automatic dispatch is switched off. */
  | "auto_dispatch_disabled"
  /** A daily call or monthly voice-second budget is spent. */
  | "budget_exhausted";

export type DispatchResult =
  | { status: "dispatched"; attempt: CallAttempt; attemptNumber: number; lead: Lead; callSid: string }
  | { status: "refused"; reason: DispatchRefusal; detail?: string }
  | { status: "failed"; message: string; retryScheduled: boolean };

/** The provider call, injectable so the preconditions can be tested without one. */
export type PlaceCall = (input: {
  to: string;
  from: string;
  instructionsUrl: string;
  statusCallbackUrl: string;
  timeLimitSeconds: number;
  /** A trial refuses the whole request if it carries a premium parameter. */
  trialAccount: boolean;
}) => Promise<string>;

export type DispatchCallInput = {
  db: Db;
  leadId: string;
  /**
   * Who asked (lifecycle-and-operations D4). Defaults to `human`, so an
   * existing caller keeps behaving exactly as it did: only a caller that
   * declares itself the run is gated by `auto_dispatch_enabled`.
   */
  origin?: DispatchOrigin;
  config?: VoiceConfig;
  placeCall?: PlaceCall;
  now?: Date;
  env?: NodeJS.ProcessEnv;
};

/**
 * The real Twilio call.
 *
 * The parameter set depends on what the account is entitled to, because a trial
 * rejects the WHOLE request rather than the offending field. The measured list
 * is on `trialAccount` in `config.ts`.
 *
 * On a full account, machine detection runs asynchronously so the call connects
 * immediately and the verdict arrives on the status callback (design D9), and
 * `timeLimit` is a belt-and-braces stop for a bridge that stops enforcing the
 * budget. A trial gets neither, and the status callback carries the outcome
 * either way.
 */
export function twilioPlaceCall(config: VoiceConfig): PlaceCall {
  const client = twilio(config.twilio.apiKeySid, config.twilio.apiKeySecret, {
    accountSid: config.twilio.accountSid,
  });

  return async ({ to, from, instructionsUrl, statusCallbackUrl, timeLimitSeconds, trialAccount }) => {
    const call = await client.calls.create({
      to,
      from,
      url: instructionsUrl,
      // Both accepted on a trial. `statusCallbackMethod` is NOT, and POST is
      // its default anyway, so leaving it out costs nothing.
      statusCallback: statusCallbackUrl,
      statusCallbackEvent: ["completed"],
      ...(trialAccount
        ? {}
        : {
            statusCallbackMethod: "POST",
            timeLimit: timeLimitSeconds,
            machineDetection: "Enable",
            asyncAmd: "true",
            asyncAmdStatusCallback: statusCallbackUrl,
            asyncAmdStatusCallbackMethod: "POST",
          }),
    });
    return call.sid;
  };
}

export async function dispatchCall({
  db,
  leadId,
  origin = "human",
  config: given,
  placeCall,
  now = new Date(),
  env = process.env,
}: DispatchCallInput): Promise<DispatchResult> {
  const resolved = given ? { ok: true as const, config: given } : readVoiceConfig(env);
  if (!resolved.ok) {
    return { status: "refused", reason: "not_configured", detail: resolved.missing.join(", ") };
  }
  const config = resolved.config;

  const lead = await getLeadById(db, leadId);
  if (!lead) return { status: "refused", reason: "lead_not_found" };
  // Checked here for a clear message, and again inside the transaction that
  // writes the attempt, which is what actually makes it safe under a race.
  if (lead.status === "opt_out") return { status: "refused", reason: "opted_out" };

  // Checked here, before anything else costs a query, and checked AGAIN inside
  // the reserving transaction where it is race-proof. A run whose switch is off
  // must not load criteria or reconcile attempts every time it wakes — and the
  // refusal it reports should name the switch, not whatever it tripped over
  // first on the way there.
  if (origin === "run") {
    const operations = await getOperationsSettings(db);
    if (!operations.autoDispatchEnabled) return { status: "refused", reason: "auto_dispatch_disabled" };
  }

  const criteria = await listActiveCriteria(db);
  if (criteria.length === 0) return { status: "refused", reason: "no_active_criteria" };

  // Change 2 made the window a rule about SCHEDULING. Nothing until now stopped
  // someone pressing a button at three in the morning (spec section 4.2).
  if (!isWithinCallWindow(now, lead.timezone)) {
    return { status: "refused", reason: "outside_call_window", detail: lead.timezone };
  }

  // Opportunistic: a lead blocked by an attempt whose callback was lost should
  // not need a cron to become callable again (design D6).
  await reconcileStaleAttempts(db, { maxCallSeconds: config.maxCallSeconds, now });

  const created = await createDispatchedAttempt(db, { leadId, now, origin });
  if (!created.ok) {
    // The detail says WHICH budget, which the portal shows: "budget exhausted"
    // with no number sends an operator to the database to find out.
    return { status: "refused", reason: created.reason, ...(created.detail ? { detail: created.detail } : {}) };
  }

  const place = placeCall ?? twilioPlaceCall(config);
  let callSid: string;
  try {
    // The webhook URLs carry a token bound to this attempt (design D13).
    // Twilio's own signature is computed with the account auth token, which an
    // API key cannot verify, so these endpoints would otherwise be public and
    // unauthenticated — and they close attempts and trigger scoring. The token
    // outlives the call by a wide margin: a status callback can arrive minutes
    // after the line drops.
    const webhookToken = mintCallToken(created.attempt.id, config.streamTokenSecret, WEBHOOK_TOKEN_TTL_MS, now.getTime());
    callSid = await place({
      to: lead.phone,
      from: config.twilio.fromNumber,
      instructionsUrl: `${config.publicBaseUrl}/api/twilio/voice?t=${webhookToken}`,
      statusCallbackUrl: `${config.publicBaseUrl}/api/twilio/status?t=${webhookToken}`,
      timeLimitSeconds: config.maxCallSeconds,
      trialAccount: config.trialAccount,
    });
  } catch (error) {
    // The attempt exists and the lead is `calling`. Closing both here is what
    // stops a provider outage from becoming a lead stuck in flight forever.
    const retry = scheduleRetry({
      attemptNumber: created.attemptNumber,
      endedAt: now,
      tz: lead.timezone,
    });
    const closed = await finishAttempt(db, {
      attemptId: created.attempt.id,
      outcome: "failed",
      endedReason: "dispatch_failed",
      endedAt: now,
      ...(retry ? { nextCallAt: retry } : {}),
    });
    return {
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
      retryScheduled: closed.ok && retry !== null,
    };
  }

  await attachCallSid(db, created.attempt.id, callSid);
  return {
    status: "dispatched",
    attempt: { ...created.attempt, twilioCallSid: callSid },
    attemptNumber: created.attemptNumber,
    lead: created.lead,
    callSid,
  };
}
