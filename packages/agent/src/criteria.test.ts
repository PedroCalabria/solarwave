import { describe, expect, it } from "vitest";
import { callOrder, questionFor, vocabularyFor, type ScriptCriterion } from "./criteria";

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

const keys = (list: ScriptCriterion[]) => list.map((c) => c.key);

describe("callOrder", () => {
  it("asks blocking criteria first, whatever their weight", () => {
    // The point of the rule: failing a blocking criterion ends the call, and
    // discovering that last would have spent the whole two-minute budget.
    const order = callOrder([
      criterion({ key: "bill", weight: 40 }),
      criterion({ key: "homeowner", weight: 10, blocking: true }),
    ]);

    expect(keys(order)).toEqual(["homeowner", "bill"]);
  });

  it("orders by descending weight within a group", () => {
    const order = callOrder([
      criterion({ key: "roof", weight: 20 }),
      criterion({ key: "bill", weight: 30 }),
      criterion({ key: "timeline", weight: 25 }),
    ]);

    expect(keys(order)).toEqual(["bill", "timeline", "roof"]);
  });

  it("orders blocking criteria among themselves by weight too", () => {
    const order = callOrder([
      criterion({ key: "b_light", weight: 10, blocking: true }),
      criterion({ key: "b_heavy", weight: 50, blocking: true }),
    ]);

    expect(keys(order)).toEqual(["b_heavy", "b_light"]);
  });

  it("falls back to sort_order when blocking and weight tie", () => {
    // sort_order is admin-controlled and audited, so it is demoted to a
    // tiebreak rather than ignored (design D5).
    const order = callOrder([
      criterion({ key: "second", weight: 20, sortOrder: 9 }),
      criterion({ key: "first", weight: 20, sortOrder: 1 }),
    ]);

    expect(keys(order)).toEqual(["first", "second"]);
  });

  it("falls back to key when everything else ties, so the script is stable", () => {
    const input = [
      criterion({ key: "zulu", weight: 20, sortOrder: 3 }),
      criterion({ key: "alpha", weight: 20, sortOrder: 3 }),
    ];

    expect(keys(callOrder(input))).toEqual(["alpha", "zulu"]);
    expect(keys(callOrder(input))).toEqual(keys(callOrder(input.slice().reverse())));
  });

  it("drops inactive criteria", () => {
    const order = callOrder([
      criterion({ key: "live" }),
      criterion({ key: "retired", active: false, blocking: true, weight: 100 }),
    ]);

    expect(keys(order)).toEqual(["live"]);
  });

  it("does not mutate its input", () => {
    const input = [criterion({ key: "b", weight: 10 }), criterion({ key: "a", weight: 50 })];
    callOrder(input);

    expect(keys(input)).toEqual(["b", "a"]);
  });

  it("handles an empty set", () => {
    expect(callOrder([])).toEqual([]);
  });
});

describe("questionFor", () => {
  it("picks the language the lead asked to be called in", () => {
    const c = criterion({ key: "homeowner", questionPt: "É seu?", questionEn: "Do you own it?" });

    expect(questionFor(c, "pt")).toBe("É seu?");
    expect(questionFor(c, "en")).toBe("Do you own it?");
  });
});

describe("vocabularyFor", () => {
  it("returns the options of an enum criterion", () => {
    const c = criterion({ key: "roof", type: "enum", options: "ceramic|metal|slab", expectedValue: "ceramic|metal" });

    expect(vocabularyFor(c)).toEqual(["ceramic", "metal", "slab"]);
  });

  it("returns nothing for a non-enum criterion", () => {
    expect(vocabularyFor(criterion({ key: "homeowner" }))).toEqual([]);
  });
});
