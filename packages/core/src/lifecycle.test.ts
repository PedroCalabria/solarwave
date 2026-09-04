import { describe, expect, it } from "vitest";
import { ATTEMPT_OUTCOMES, LEAD_STATUSES, isTerminal, transition, type LeadStatus } from "./lifecycle";

const ended = (outcome: (typeof ATTEMPT_OUTCOMES)[number], attemptCount: number, decision?: "qualified" | "disqualified") =>
  ({ type: "attempt_ended", outcome, attemptCount, decision }) as const;

describe("transition", () => {
  it("dispatches from new and waiting_retry", () => {
    expect(transition("new", { type: "dispatch" })).toEqual({ ok: true, value: "calling" });
    expect(transition("waiting_retry", { type: "dispatch" })).toEqual({ ok: true, value: "calling" });
  });

  it("rejects dispatch while calling", () => {
    const r = transition("calling", { type: "dispatch" });
    expect(r.ok).toBe(false);
  });

  it.each(["no_answer", "busy", "voicemail", "failed", "answered_incomplete", "minor_answered"] as const)(
    "%s with attempts remaining goes to waiting_retry",
    (outcome) => {
      expect(transition("calling", ended(outcome, 1))).toEqual({ ok: true, value: "waiting_retry" });
      expect(transition("calling", ended(outcome, 2))).toEqual({ ok: true, value: "waiting_retry" });
    },
  );

  it.each(["no_answer", "busy", "voicemail", "failed", "answered_incomplete", "minor_answered"] as const)(
    "%s on the third attempt goes to no_answer_final",
    (outcome) => {
      expect(transition("calling", ended(outcome, 3))).toEqual({ ok: true, value: "no_answer_final" });
    },
  );

  it("answered_complete follows the decision", () => {
    expect(transition("calling", ended("answered_complete", 1, "qualified"))).toEqual({ ok: true, value: "qualified" });
    expect(transition("calling", ended("answered_complete", 2, "disqualified"))).toEqual({
      ok: true,
      value: "disqualified",
    });
  });

  it("answered_complete without a decision is an error", () => {
    const r = transition("calling", ended("answered_complete", 1));
    expect(r).toEqual({ ok: false, error: { code: "missing_decision" } });
  });

  it("abusive disqualifies directly", () => {
    expect(transition("calling", ended("abusive", 1))).toEqual({ ok: true, value: "disqualified" });
  });

  it("opt_out outcome and opt_out event both end in opt_out", () => {
    expect(transition("calling", ended("opt_out", 1))).toEqual({ ok: true, value: "opt_out" });
    expect(transition("calling", { type: "opt_out" })).toEqual({ ok: true, value: "opt_out" });
  });

  it.each(["new", "calling", "waiting_retry"] as LeadStatus[])("opt_out from %s is allowed", (status) => {
    expect(transition(status, { type: "opt_out" })).toEqual({ ok: true, value: "opt_out" });
  });

  it("attempt_ended is only valid while calling", () => {
    expect(transition("new", ended("no_answer", 1)).ok).toBe(false);
    expect(transition("waiting_retry", ended("no_answer", 1)).ok).toBe(false);
  });

  it.each(["qualified", "disqualified", "no_answer_final", "opt_out"] as LeadStatus[])(
    "%s is terminal and rejects every event",
    (status) => {
      expect(isTerminal(status)).toBe(true);
      expect(transition(status, { type: "dispatch" })).toEqual({ ok: false, error: { code: "terminal", status } });
      expect(transition(status, { type: "opt_out" })).toEqual({ ok: false, error: { code: "terminal", status } });
      expect(transition(status, ended("no_answer", 1))).toEqual({ ok: false, error: { code: "terminal", status } });
    },
  );

  it("covers every status in the table", () => {
    expect(LEAD_STATUSES).toHaveLength(7);
    expect(ATTEMPT_OUTCOMES).toHaveLength(9);
  });
});
