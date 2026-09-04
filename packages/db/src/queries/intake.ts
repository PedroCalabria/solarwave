import { dddToTimezone, nextAllowedTime, normalizePhone, type PhoneError } from "@solarwave/core";
import type { DbOrTx } from "../client";
import { leads, type CallLanguage, type Lead } from "../schema";
import { getLeadByPhone } from "./leads";

export type IntakeInput = {
  name: string;
  email: string;
  /** Raw phone as typed by the visitor. */
  phone: string;
  preferredCallLanguage: CallLanguage;
  source?: string;
  now?: Date;
};

export type IntakeOutcome = { status: "created"; lead: Lead } | { status: "existing"; lead: Lead };

export type IntakeError = { field: "phone"; error: PhoneError | "unknown_ddd" };

/**
 * Atomic dedup (design D7): `INSERT ... ON CONFLICT (phone) DO NOTHING`. When
 * the phone already exists the stored lead is returned untouched, which also
 * guarantees an `opt_out` lead is never re-scheduled (spec section 6).
 */
export async function createLeadIfNew(
  db: DbOrTx,
  input: IntakeInput,
): Promise<{ ok: true; value: IntakeOutcome } | { ok: false; error: IntakeError }> {
  const phone = normalizePhone(input.phone);
  if (!phone.ok) return { ok: false, error: { field: "phone", error: phone.error } };

  const tz = dddToTimezone(phone.value.ddd);
  if (!tz.ok) return { ok: false, error: { field: "phone", error: "unknown_ddd" } };

  const now = input.now ?? new Date();
  const inserted = await db
    .insert(leads)
    .values({
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      phone: phone.value.e164,
      ddd: phone.value.ddd,
      timezone: tz.value,
      preferredCallLanguage: input.preferredCallLanguage,
      status: "new",
      source: input.source ?? "landing_page",
      nextCallAt: nextAllowedTime(now, tz.value),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: leads.phone })
    .returning();

  if (inserted[0]) return { ok: true, value: { status: "created", lead: inserted[0] } };

  const existing = await getLeadByPhone(db, phone.value.e164);
  if (!existing) {
    // The conflicting row vanished between insert and select (deleted concurrently). Retry once.
    return createLeadIfNew(db, input);
  }
  return { ok: true, value: { status: "existing", lead: existing } };
}
