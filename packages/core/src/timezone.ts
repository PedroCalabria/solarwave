import { err, ok, type Result } from "./result";

export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

/**
 * Brazilian DDDs outside the America/Sao_Paulo zone (design D6). Every other
 * valid DDD maps to the default. Fernando de Noronha has no DDD of its own.
 */
const NON_DEFAULT_ZONES: Record<string, string> = {
  "65": "America/Cuiaba",
  "66": "America/Cuiaba",
  "67": "America/Campo_Grande",
  "92": "America/Manaus",
  "97": "America/Manaus",
  "95": "America/Boa_Vista",
  "69": "America/Porto_Velho",
  "68": "America/Rio_Branco",
};

/** All DDDs in use in Brazil (ANATEL). */
const VALID_DDDS = new Set<string>([
  "11", "12", "13", "14", "15", "16", "17", "18", "19",
  "21", "22", "24", "27", "28",
  "31", "32", "33", "34", "35", "37", "38",
  "41", "42", "43", "44", "45", "46", "47", "48", "49",
  "51", "53", "54", "55",
  "61", "62", "63", "64", "65", "66", "67", "68", "69",
  "71", "73", "74", "75", "77", "79",
  "81", "82", "83", "84", "85", "86", "87", "88", "89",
  "91", "92", "93", "94", "95", "96", "97", "98", "99",
]);

export function isValidDdd(ddd: string): boolean {
  return VALID_DDDS.has(ddd);
}

export function dddToTimezone(ddd: string): Result<string, "unknown_ddd"> {
  if (!isValidDdd(ddd)) return err("unknown_ddd");
  return ok(NON_DEFAULT_ZONES[ddd] ?? DEFAULT_TIMEZONE);
}
