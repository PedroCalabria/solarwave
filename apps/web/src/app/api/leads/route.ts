import { getDb } from "@solarwave/db";
import { createIntakeHandler } from "@/lib/intake/handler";
import { verifyTurnstileToken } from "@/lib/turnstile";

/**
 * Intake API — spec sections 3 and 4.1–4.2. Validation, CAPTCHA, DB-backed rate
 * limiting and atomic phone dedup live in `@/lib/intake/handler`; this file only
 * wires the real dependencies.
 */
export async function POST(request: Request) {
  const handler = createIntakeHandler({
    db: getDb(),
    verifyTurnstile: verifyTurnstileToken,
    ipSalt: process.env.INTAKE_IP_SALT ?? "solarwave",
  });
  return handler(request);
}
