import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { err, ok, type Result } from "./result";

export type NormalizedPhone = {
  /** E.164, e.g. "+5511988421170". This is the deduplication key. */
  e164: string;
  /** Two-digit Brazilian area code, e.g. "11". */
  ddd: string;
  /** National number without the country code. */
  national: string;
};

export type PhoneError = "invalid" | "not_brazil";

/**
 * Phase 1 accepts Brazilian numbers only (spec section 4.2 derives the timezone
 * from the DDD). A number typed without "+" is parsed as Brazilian; an explicit
 * "+<country>" prefix that is not +55 is rejected rather than guessed at.
 */
export function normalizePhone(input: string): Result<NormalizedPhone, PhoneError> {
  const parsed = parsePhoneNumberFromString(input.trim(), "BR");
  if (!parsed || !parsed.isValid()) return err("invalid");
  if (parsed.country !== "BR") return err("not_brazil");

  const national = parsed.nationalNumber;
  if (national.length < 10) return err("invalid");

  return ok({
    e164: parsed.number,
    ddd: national.slice(0, 2),
    national,
  });
}
