import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(import.meta.dirname, "route.ts"), "utf8");
const page = readFileSync(
  resolve(import.meta.dirname, "../../portal/(shell)/harness/page.tsx"),
  "utf8",
);

/**
 * A harness session is a rehearsal (voice-harness spec, task 7.3).
 *
 * These assertions are structural rather than behavioural because the thing
 * worth guaranteeing is an absence, and an absence is easiest to lose by
 * accident: someone adds "and score it while we're here" months from now and
 * every behavioural test still passes. Reading the source is blunt, and it
 * fails loudly the moment a write is introduced.
 */
describe("the harness persists nothing", () => {
  const writers = [
    "createSimulatedAttempt",
    "createDispatchedAttempt",
    "finishAttempt",
    "applyLeadTransition",
    "saveScoringResult",
    "scoreAttempt",
    "simulateCall",
    "setScoringStatus",
    "replaceViolations",
  ];

  it.each(writers)("does not call %s", (writer) => {
    expect(source).not.toContain(writer);
    expect(page).not.toContain(writer);
  });

  it("reads criteria and nothing else from the database", () => {
    const imports = source.match(/from "@solarwave\/db"/g) ?? [];
    expect(imports).toHaveLength(1);
    expect(source).toContain("listActiveCriteria");
    // The only other db symbol is the connection itself.
    const named = source.match(/import \{([^}]*)\} from "@solarwave\/db"/)?.[1] ?? "";
    expect(
      named
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .sort(),
    ).toEqual(["getDb", "listActiveCriteria"]);
  });

  it("tells the operator that nothing was persisted", () => {
    expect(source).toContain("persisted: false");
  });
});

describe("the harness is admin-only", () => {
  it("refuses a signed-out request and a non-admin one", () => {
    expect(source).toContain('return new Response("unauthorised", { status: 401 })');
    expect(source).toContain('return new Response("forbidden", { status: 403 })');
  });

  it("guards the page as well as the socket", () => {
    expect(page).toContain('redirect("/portal/login?error=not_employee")');
    expect(page).toContain('employee.role !== "admin"');
  });
});
