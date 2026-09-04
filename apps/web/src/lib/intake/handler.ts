import { consumeIntakeRateLimit, createLeadIfNew, hashIp, type Db } from "@solarwave/db";
import { z } from "zod";
import { LOCALES, type Locale } from "@/lib/i18n";
import type { TurnstileVerifier } from "@/lib/turnstile";

/**
 * Intake API (spec sections 3 and 4.1-4.2, lead-intake spec).
 * Order: parse -> CAPTCHA (no DB access before this) -> rate limit -> field
 * validation -> atomic insert. Dependencies are injected so route tests can
 * run against the integration database with a fake verifier.
 */

const payloadSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  preferredCallLanguage: z.string().optional(),
  turnstileToken: z.string().optional(),
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type IntakeDeps = {
  db: Db;
  verifyTurnstile: TurnstileVerifier;
  ipSalt: string;
  now?: () => Date;
};

const PHONE_MESSAGES: Record<string, string> = {
  invalid: "Phone number is not valid.",
  not_brazil: "Only Brazilian numbers (+55) are accepted at the moment.",
  unknown_ddd: "The area code (DDD) is not recognised.",
};

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export function createIntakeHandler(deps: IntakeDeps) {
  return async function handleIntake(request: Request): Promise<Response> {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return json({ error: "Malformed JSON body.", code: "malformed" }, 400);
    }
    const parsed = payloadSchema.safeParse(raw);
    if (!parsed.success) return json({ error: "Malformed JSON body.", code: "malformed" }, 400);
    const body = parsed.data;

    // CAPTCHA before any database access.
    const ip = clientIp(request);
    if (!body.turnstileToken) return json({ error: "CAPTCHA token is required.", code: "captcha_missing" }, 400);
    const human = await deps.verifyTurnstile(body.turnstileToken, ip === "unknown" ? null : ip);
    if (!human) return json({ error: "CAPTCHA verification failed.", code: "captcha_failed" }, 403);

    // Durable per-client rate limit.
    const now = deps.now?.() ?? new Date();
    const limit = await consumeIntakeRateLimit(deps.db, hashIp(ip, deps.ipSalt), now);
    if (!limit.allowed) {
      return new Response(JSON.stringify({ error: "Too many requests. Try again shortly.", code: "rate_limited" }), {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": String(Math.max(1, Math.ceil((limit.resetAt.getTime() - now.getTime()) / 1000))),
        },
      });
    }

    // Field validation.
    const name = (body.name ?? "").trim();
    const phone = (body.phone ?? "").trim();
    const email = (body.email ?? "").trim();
    const fieldErrors: Record<string, string> = {};
    if (name.length < 3 || name.length > 120) fieldErrors.name = "Name is too short.";
    if (phone.replace(/\D/g, "").length < 8) fieldErrors.phone = PHONE_MESSAGES.invalid!;
    if (!EMAIL.test(email) || email.length > 200) fieldErrors.email = "Email is not valid.";
    if (Object.keys(fieldErrors).length > 0) {
      return json({ error: "Validation failed.", code: "validation", fieldErrors }, 422);
    }

    // Spec section 3.2: unrecognised values fall back to pt rather than rejecting the lead.
    const preferredCallLanguage: Locale = (LOCALES as readonly string[]).includes(body.preferredCallLanguage ?? "")
      ? (body.preferredCallLanguage as Locale)
      : "pt";

    const result = await createLeadIfNew(deps.db, { name, email, phone, preferredCallLanguage, now });
    if (!result.ok) {
      return json(
        { error: "Validation failed.", code: "validation", fieldErrors: { phone: PHONE_MESSAGES[result.error.error] } },
        422,
      );
    }

    const { status, lead } = result.value;
    return json(
      {
        status,
        lead: {
          id: lead.id,
          name: lead.name,
          phone: lead.phone,
          email: lead.email,
          preferredCallLanguage: lead.preferredCallLanguage,
          status: lead.status,
          nextCallAt: lead.nextCallAt?.toISOString() ?? null,
        },
      },
      status === "created" ? 201 : 200,
    );
  };
}
