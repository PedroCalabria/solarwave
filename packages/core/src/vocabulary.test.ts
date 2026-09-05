import { describe, expect, it } from "vitest";
import { parseOptionList, validateVocabulary } from "./scoring";

describe("parseOptionList", () => {
  it("splits, trims and lowercases members", () => {
    expect(parseOptionList(" Ceramic | METAL |slab ")).toEqual(["ceramic", "metal", "slab"]);
  });

  it("drops empty members and treats null as empty", () => {
    expect(parseOptionList("a||b|")).toEqual(["a", "b"]);
    expect(parseOptionList(null)).toEqual([]);
  });
});

describe("validateVocabulary", () => {
  const enumCriterion = (options: string | null, expectedValue: string | null) =>
    validateVocabulary({ type: "enum" as const, options, expectedValue });

  it("accepts a vocabulary with a passing subset", () => {
    expect(enumCriterion("this_month|within_3_months|within_6_months", "this_month|within_3_months")).toEqual([]);
  });

  it("accepts a vocabulary where every member passes", () => {
    expect(enumCriterion("ceramic|metal", "ceramic|metal")).toEqual([]);
  });

  it("rejects an enum with no vocabulary", () => {
    const errors = enumCriterion(null, "ceramic");
    expect(errors.some((e) => e.field === "options")).toBe(true);
  });

  it("rejects an enum with a single option", () => {
    const errors = enumCriterion("ceramic", "ceramic");
    expect(errors.some((e) => e.field === "options")).toBe(true);
  });

  it("rejects repeated options", () => {
    const errors = enumCriterion("ceramic|metal|ceramic", "ceramic");
    expect(errors.some((e) => e.message.includes("repeat"))).toBe(true);
  });

  it("rejects an expected value outside the vocabulary and names the offender", () => {
    const errors = enumCriterion("ceramic|metal", "ceramic|slab");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.field).toBe("expectedValue");
    expect(errors[0]!.message).toContain("slab");
  });

  it("rejects an enum that accepts nothing", () => {
    const errors = enumCriterion("ceramic|metal", null);
    expect(errors.some((e) => e.field === "expectedValue")).toBe(true);
  });

  it("rejects options on a non-enum criterion", () => {
    expect(validateVocabulary({ type: "numeric", options: "a|b", expectedValue: ">= 300" })).toEqual([
      { field: "options", message: "only enum criteria have an options vocabulary" },
    ]);
  });

  it("allows a non-enum criterion with no options", () => {
    expect(validateVocabulary({ type: "boolean", options: null, expectedValue: "true" })).toEqual([]);
    expect(validateVocabulary({ type: "free_text", options: null, expectedValue: null })).toEqual([]);
  });

  it("narrowing what passes does not shrink the vocabulary", () => {
    // The seeded 2026-08-21 audit row: within_6_months stopped passing but is
    // still an answer a lead can give, which is the whole point of the split.
    const options = "this_month|within_3_months|within_6_months";
    expect(enumCriterion(options, "this_month|within_3_months|within_6_months")).toEqual([]);
    expect(enumCriterion(options, "this_month|within_3_months")).toEqual([]);
    expect(parseOptionList(options)).toContain("within_6_months");
  });
});
