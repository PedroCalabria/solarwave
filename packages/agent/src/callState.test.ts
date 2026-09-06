import { DEFAULT_SETTINGS, type AttemptOutcome } from "@solarwave/core";
import { describe, expect, it } from "vitest";
import { CallState, outcomeFor, readAnswer, readCallbackTime, readReason } from "./callState";
import type { ScriptCriterion } from "./criteria";
import { END_CALL_REASONS, type EndCallReason } from "./tools";

const criterion = (over: Partial<ScriptCriterion> & { key: string }): ScriptCriterion => ({
  label: over.key,
  questionPt: `pergunta ${over.key}`,
  questionEn: `question ${over.key}`,
  type: "boolean",
  options: null,
  expectedValue: "true",
  weight: 10,
  blocking: false,
  active: true,
  sortOrder: 0,
  ...over,
});

const ORDER: ScriptCriterion[] = [
  criterion({ key: "homeowner", weight: 30, blocking: true }),
  criterion({ key: "monthly_bill", type: "numeric", expectedValue: ">= 300", weight: 25 }),
  criterion({ key: "roof_type", type: "enum", options: "ceramic|metal", expectedValue: "ceramic", weight: 20 }),
];

const state = () => new CallState({ order: ORDER, settings: DEFAULT_SETTINGS });

describe("argument parsing", () => {
  it("keeps a well-formed answer", () => {
    expect(readAnswer({ criterion_key: "homeowner", value: "true" })).toEqual({
      criterionKey: "homeowner",
      value: "true",
    });
  });

  it("defaults a missing value rather than dropping the answer", () => {
    // Measured against Gemini Live: the model calls record_answer with only
    // criterion_key, even though the schema marks value as required.
    expect(readAnswer({ criterion_key: "homeowner" })).toEqual({ criterionKey: "homeowner", value: "" });
  });

  it("ignores an answer with no criterion key", () => {
    expect(readAnswer({ value: "true" })).toBeNull();
    expect(readAnswer({ criterion_key: "", value: "true" })).toBeNull();
    expect(readAnswer(null)).toBeNull();
    expect(readAnswer("record_answer")).toBeNull();
  });

  it("reads an end reason and tolerates its absence", () => {
    expect(readReason({ reason: "opt_out" })).toBe("opt_out");
    expect(readReason({})).toBeNull();
    expect(readReason(null)).toBeNull();
  });

  it("reads a callback time and rejects an empty one", () => {
    expect(readCallbackTime({ preferred_time: "  amanhã de manhã " })).toBe("amanhã de manhã");
    expect(readCallbackTime({ preferred_time: "   " })).toBeNull();
    expect(readCallbackTime({})).toBeNull();
  });
});

describe("outcomeFor", () => {
  const cases: [EndCallReason, boolean, AttemptOutcome][] = [
    ["opt_out", true, "opt_out"],
    ["opt_out", false, "opt_out"],
    ["minor", false, "minor_answered"],
    ["hostile", false, "abusive"],
    ["enough_information", true, "answered_complete"],
    ["enough_information", false, "answered_incomplete"],
    ["callback_requested", true, "answered_incomplete"],
    ["lead_declined", true, "answered_incomplete"],
    ["incomplete", true, "answered_incomplete"],
  ];

  it.each(cases)("%s with enough=%s maps to %s", (reason, enough, expected) => {
    expect(outcomeFor(reason, enough)).toBe(expected);
  });

  it("maps blocking_failed to answered_complete however little was answered", () => {
    // A lead who fails a blocking criterion is disqualified whatever the rest
    // says, so calling a renter back to confirm they still rent is the outcome
    // this mapping exists to prevent.
    expect(outcomeFor("blocking_failed", false)).toBe("answered_complete");
    expect(outcomeFor("blocking_failed", true)).toBe("answered_complete");
  });

  it("covers every declared end reason", () => {
    for (const reason of END_CALL_REASONS) {
      expect(outcomeFor(reason, true)).toBeTruthy();
      expect(outcomeFor(reason, false)).toBeTruthy();
    }
  });
});

describe("precedence between tool calls", () => {
  it("opt-out outranks a stated end reason", () => {
    const s = state();
    s.apply({ name: "mark_opt_out", input: {} });
    s.apply({ name: "end_call", input: { reason: "enough_information" } });
    expect(s.terminalReason()).toBe("opt_out");
    expect(s.outcome(s.terminalReason()!)).toBe("opt_out");
  });

  it("opt-out outranks it whichever order the calls arrive in", () => {
    const s = state();
    s.apply({ name: "end_call", input: { reason: "enough_information" } });
    s.apply({ name: "mark_opt_out", input: {} });
    expect(s.terminalReason()).toBe("opt_out");
  });

  it("opt-out outranks an unanswered blocking criterion", () => {
    const s = state();
    s.apply({ name: "mark_opt_out", input: {} });
    expect(s.enoughInformation()).toBe(false);
    expect(s.terminalReason()).toBe("opt_out");
  });

  it("a stated reason outranks a flagged minor", () => {
    const s = state();
    s.apply({ name: "flag_minor", input: {} });
    s.apply({ name: "end_call", input: { reason: "hostile" } });
    expect(s.terminalReason()).toBe("hostile");
  });

  it("a flagged minor ends the call when nothing else does", () => {
    const s = state();
    s.apply({ name: "flag_minor", input: {} });
    expect(s.terminalReason()).toBe("minor");
    expect(s.outcome("minor")).toBe("minor_answered");
  });

  it("nothing ends a call that is still running", () => {
    const s = state();
    s.apply({ name: "record_answer", input: { criterion_key: "homeowner", value: "true" } });
    expect(s.terminalReason()).toBeNull();
  });

  it("an end_call with no arguments is incomplete, not a guess", () => {
    const s = state();
    s.apply({ name: "end_call", input: {} });
    expect(s.terminalReason()).toBe("incomplete");
  });

  it("ignores a tool it does not know", () => {
    const s = state();
    s.apply({ name: "book_installation", input: { when: "tomorrow" } });
    expect(s.terminalReason()).toBeNull();
    expect(s.liveAnswers).toEqual([]);
  });
});

describe("answers and enough information", () => {
  it("keeps the last answer for a criterion", () => {
    const s = state();
    s.apply({ name: "record_answer", input: { criterion_key: "homeowner", value: "false" } });
    s.apply({ name: "record_answer", input: { criterion_key: "homeowner", value: "true" } });
    expect(s.liveAnswers).toEqual([{ criterionKey: "homeowner", value: "true" }]);
  });

  it("is not satisfied while a blocking criterion is unanswered", () => {
    const s = state();
    s.apply({ name: "record_answer", input: { criterion_key: "monthly_bill", value: "450" } });
    s.apply({ name: "record_answer", input: { criterion_key: "roof_type", value: "ceramic" } });
    expect(s.enoughInformation()).toBe(false);
  });

  it("is satisfied once the blocking criterion and enough weight are answered", () => {
    const s = state();
    for (const c of ORDER) s.apply({ name: "record_answer", input: { criterion_key: c.key, value: "true" } });
    expect(s.enoughInformation()).toBe(true);
  });
});

describe("reasonWhenCutOff", () => {
  it("reports enough_information when the transport stopped a satisfied call", () => {
    const s = state();
    for (const c of ORDER) s.apply({ name: "record_answer", input: { criterion_key: c.key, value: "true" } });
    expect(s.reasonWhenCutOff()).toBe("enough_information");
    expect(s.outcome(s.reasonWhenCutOff())).toBe("answered_complete");
  });

  it("reports incomplete when the transport stopped an unsatisfied call", () => {
    const s = state();
    expect(s.reasonWhenCutOff()).toBe("incomplete");
    expect(s.outcome(s.reasonWhenCutOff())).toBe("answered_incomplete");
  });

  it("still honours opt-out when the transport cut the call", () => {
    const s = state();
    s.apply({ name: "mark_opt_out", input: {} });
    expect(s.reasonWhenCutOff()).toBe("opt_out");
  });
});

describe("requested callback", () => {
  it("captures the time verbatim without scheduling anything", () => {
    const s = state();
    s.apply({ name: "request_callback", input: { preferred_time: "depois das 18h" } });
    expect(s.requestedCallback).toBe("depois das 18h");
    expect(s.terminalReason()).toBeNull();
  });

  it("keeps the previous time when a later call carries none", () => {
    const s = state();
    s.apply({ name: "request_callback", input: { preferred_time: "amanhã" } });
    s.apply({ name: "request_callback", input: {} });
    expect(s.requestedCallback).toBe("amanhã");
  });
});
