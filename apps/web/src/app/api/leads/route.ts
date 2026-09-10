import { getDb } from "@solarwave/db";
import { createIntakeHandler } from "@/lib/intake/handler";
import { startLeadRun } from "@/lib/leadRun";
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
    // Spec section 4.1: intake schedules the first attempt. Until now that meant
    // writing `next_call_at` and hoping someone pressed a button.
    startLeadRun: async (leadId) => void (await startLeadRun(leadId)),
  });
  return handler(request);
}
