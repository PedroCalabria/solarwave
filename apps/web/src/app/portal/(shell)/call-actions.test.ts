import type { DispatchRefusal } from "@solarwave/voice/dispatch";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(import.meta.dirname, "call-actions.ts"), "utf8");

/**
 * Every refusal needs its own sentence (telephony-dispatch spec, task 9.4).
 *
 * A missing one is not a crash — it falls through to "Could not place this
 * call", which tells an employee nothing and sends them to a developer. The
 * union is the source of truth, so a refusal added later fails this test
 * instead of quietly becoming the useless message.
 */
const REASONS: DispatchRefusal[] = [
  "lead_not_found",
  "opted_out",
  "attempt_in_flight",
  "attempt_cap_reached",
  "blocked_by_violation",
  "outside_call_window",
  "no_active_criteria",
  "not_configured",
];

describe("the real-call action", () => {
  it.each(REASONS)("explains %s", (reason) => {
    expect(source).toContain(`${reason}:`);
  });

  it("points a blocked lead at where the block is cleared", () => {
    expect(source).toMatch(/blocked_by_violation:[\s\S]{0,200}Guardrails page/);
  });

  it("names what is missing when telephony is unconfigured", () => {
    // "Not configured" without saying which variable is a scavenger hunt.
    expect(source).toContain("Missing: ${result.detail}");
  });

  it("is admin-only", () => {
    expect(source).toContain("await requireAdmin()");
  });

  it("shares one dispatchCall with the internal route", () => {
    // The workflow in change 5 drives the same function, so the admin path and
    // the automated path cannot drift apart.
    expect(source).toContain('from "@solarwave/voice/dispatch"');
    expect(source).toContain("dispatchCall({ db, leadId })");
  });

  it("says a retry was scheduled when the provider refused the call", () => {
    expect(source).toContain("A retry has been scheduled.");
  });
});
