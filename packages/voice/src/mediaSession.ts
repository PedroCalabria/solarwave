import type { ScriptCriterion } from "@solarwave/agent";
import {
  findAttemptByCallSid,
  getLeadById,
  listActiveCriteria,
  type CallAttempt,
  type Db,
  type Lead,
} from "@solarwave/db";
import { verifyCallToken } from "./callToken";
import type { VoiceConfig } from "./config";

/**
 * Everything the media bridge decides BEFORE it opens a model session
 * (voice-bridge task 10.2).
 *
 * Lifted out of the route because the route is where none of it can be tested:
 * it needs an upgraded socket and a live provider. These refusals are the ones
 * that matter most — each is the difference between rejecting a stranger and
 * starting a paid realtime session on their behalf, or feeding a transcript
 * into somebody else's lead.
 *
 * Server-only: it reads the database, so it sits behind a subpath and never
 * the package barrel.
 */

export type StreamStartRefusal =
  | "bad_token"
  | "unknown_call"
  | "attempt_already_ended"
  | "lead_not_found"
  | "no_active_criteria";

export type StreamStart =
  | { ok: true; attempt: CallAttempt; lead: Lead; criteria: ScriptCriterion[] }
  | { ok: false; reason: StreamStartRefusal };

export type ResolveStreamStartInput = {
  db: Db;
  config: VoiceConfig;
  callSid: string;
  token: string | null;
  now?: number;
};

export async function resolveStreamStart({
  db,
  config,
  callSid,
  token,
  now,
}: ResolveStreamStartInput): Promise<StreamStart> {
  // First, always. Twilio does not sign the WebSocket upgrade, so this token is
  // the only thing standing between a guessed URL and a realtime session billed
  // to us. Checked before a single query runs.
  if (!verifyCallToken(token, callSid, config.streamTokenSecret, now).ok) {
    return { ok: false, reason: "bad_token" };
  }

  const attempt = await findAttemptByCallSid(db, callSid);
  if (!attempt) return { ok: false, reason: "unknown_call" };
  // A token stays valid for longer than a call lasts, so a replayed stream on a
  // finished attempt has to be refused explicitly.
  if (attempt.endedAt) return { ok: false, reason: "attempt_already_ended" };

  const lead = await getLeadById(db, attempt.leadId);
  if (!lead) return { ok: false, reason: "lead_not_found" };

  const criteria = toScriptCriteria(await listActiveCriteria(db));
  if (criteria.length === 0) return { ok: false, reason: "no_active_criteria" };

  return { ok: true, attempt, lead, criteria };
}

function toScriptCriteria(rows: Awaited<ReturnType<typeof listActiveCriteria>>): ScriptCriterion[] {
  return rows.map((c) => ({
    key: c.key,
    label: c.label,
    questionPt: c.questionPt,
    questionEn: c.questionEn,
    type: c.type,
    options: c.options,
    expectedValue: c.expectedValue,
    weight: c.weight,
    blocking: c.blocking,
    active: c.active,
    sortOrder: c.sortOrder,
  }));
}
