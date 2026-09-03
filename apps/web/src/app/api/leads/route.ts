import { NextResponse } from "next/server";
import { LOCALES } from "@/lib/i18n";

/**
 * Intake API — spec §3 and §4.1.
 *
 * This is the real validation and dedup shape, backed by process memory instead
 * of Postgres. Still missing before production, all called out in the spec:
 *   - CAPTCHA verification and durable rate limiting (§3.3)
 *   - persistence + the `leads.phone` unique index that makes dedup atomic (§8)
 *   - DDD -> timezone resolution and scheduling of attempt 1 (§4.2)
 */

type LeadPayload = {
  name: string;
  phone: string;
  email: string;
  preferredCallLanguage: string;
};

const DEFAULT_COUNTRY_CODE = "55";

/**
 * Collapse a typed number to an E.164-style digit string so "(11) 98842-1170"
 * and "+5511988421170" resolve to the same dedup key.
 *
 * A number written without "+" is assumed to be Brazilian, which is the region
 * the spec targets (§4.2 derives the timezone from the DDD). An international
 * number must therefore be entered with its "+" prefix — otherwise a 10-digit
 * US number is indistinguishable from a DDD + 8-digit landline. Replace this
 * with libphonenumber and an explicit country selector before launch.
 */
function normalisePhone(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return digits;

  const national = digits.replace(/^0+/, "");
  // 10 or 11 digits is DDD + subscriber number; anything longer already carries a country code.
  if (national.length === 10 || national.length === 11) {
    return DEFAULT_COUNTRY_CODE + national;
  }
  return national;
}

const seenPhones = new Set<string>();

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, { count: number; resetAt: number }>();

/** Per-IP throttle. Process-local, so it resets on deploy and does not span instances. */
function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now > entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 });
  }

  let body: Partial<LeadPayload>;
  try {
    body = (await request.json()) as Partial<LeadPayload>;
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const language =
    typeof body.preferredCallLanguage === "string" ? body.preferredCallLanguage : "pt";

  const fieldErrors: Record<string, string> = {};
  if (name.length < 3) fieldErrors.name = "Name is too short.";
  if (normalisePhone(phone).length < 8) fieldErrors.phone = "Phone number is not valid.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fieldErrors.email = "Email is not valid.";

  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json({ error: "Validation failed.", fieldErrors }, { status: 422 });
  }

  // Spec §3.2: unrecognised values fall back to pt rather than rejecting the lead.
  const preferredCallLanguage = (LOCALES as readonly string[]).includes(language) ? language : "pt";

  const key = normalisePhone(phone);
  const duplicate = seenPhones.has(key);
  seenPhones.add(key);

  return NextResponse.json(
    {
      // Spec §3.4: an existing phone reuses the lead rather than creating a second one.
      status: duplicate ? "existing" : "created",
      lead: { name, phone, email, preferredCallLanguage },
    },
    { status: duplicate ? 200 : 201 },
  );
}
