import { isWithinCallWindow, scheduleRetry } from "@solarwave/core";
import {
  attachCallSid,
  createDispatchedAttempt,
  finishAttempt,
  getLeadById,
  listActiveCriteria,
  reconcileStaleAttempts,
  type CallAttempt,
  type Db,
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
  | "not_configured";

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
}) => Promise<string>;

export type DispatchCallInput = {
  db: Db;
  leadId: string;
  config?: VoiceConfig;
  placeCall?: PlaceCall;
  now?: Date;
  env?: NodeJS.ProcessEnv;
};

/**
 * The real Twilio call.
 *
 * Machine detection runs asynchronously so the call connects immediately and
 * the verdict arrives on the status callback (design D9). `timeLimit` is a
 * belt-and-braces stop: if the bridge stops enforcing the budget, Twilio still
 * hangs up rather than leaving a line open against a 75-minute allowance.
 */
export function twilioPlaceCall(config: VoiceConfig): PlaceCall {
  const client = twilio(config.twilio.apiKeySid, config.twilio.apiKeySecret, {
    accountSid: config.twilio.accountSid,
  });

  return async ({ to, from, instructionsUrl, statusCallbackUrl, timeLimitSeconds }) => {
    const call = await client.calls.create({
      to,
      from,
      url: instructionsUrl,
      statusCallback: statusCallbackUrl,
      statusCallbackEvent: ["completed"],
      statusCallbackMethod: "POST",
      machineDetection: "Enable",
      asyncAmd: "true",
      asyncAmdStatusCallback: statusCallbackUrl,
      asyncAmdStatusCallbackMethod: "POST",
      timeLimit: timeLimitSeconds,
    });
    return call.sid;
  };
}

export async function dispatchCall({
  db,
  leadId,
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

  const created = await createDispatchedAttempt(db, { leadId, now });
  if (!created.ok) return { status: "refused", reason: created.reason };

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
