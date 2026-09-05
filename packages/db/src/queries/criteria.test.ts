import { describe, expect, it } from "vitest";
import { validateCriterionInput, type CriterionInput } from "./criteria";

const valid: CriterionInput = {
  key: "homeowner",
  label: "Homeowner verification",
  questionPt: "O imóvel é seu ou alugado?",
  questionEn: "Do you own the property or rent it?",
  type: "boolean",
  options: null,
  expectedValue: "true",
  weight: 30,
  blocking: true,
  active: true,
};

describe("validateCriterionInput", () => {
  it("accepts a valid criterion", () => {
    expect(validateCriterionInput(valid)).toEqual([]);
  });

  it("rejects weight outside 0-100", () => {
    expect(validateCriterionInput({ ...valid, weight: 120 }).map((e) => e.field)).toEqual(["weight"]);
    expect(validateCriterionInput({ ...valid, weight: 12.5 }).map((e) => e.field)).toEqual(["weight"]);
  });

  it("rejects an expected value that does not parse for the type", () => {
    const errors = validateCriterionInput({ ...valid, type: "numeric", expectedValue: "high" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ field: "expectedValue" });
    expect(errors[0]?.message).toContain(">= 300");
  });

  it("rejects a key that is not snake_case", () => {
    expect(validateCriterionInput({ ...valid, key: "Home Owner" }).map((e) => e.field)).toEqual(["key"]);
  });

  it("requires both questions", () => {
    const fields = validateCriterionInput({ ...valid, questionPt: "", questionEn: "" }).map((e) => e.field);
    expect(fields).toEqual(["questionPt", "questionEn"]);
  });

  it("free_text needs no expected value", () => {
    expect(validateCriterionInput({ ...valid, type: "free_text", expectedValue: null })).toEqual([]);
  });

  it("accepts an enum whose expected values are a subset of its options", () => {
    const errors = validateCriterionInput({
      ...valid,
      type: "enum",
      options: "this_month|within_3_months|within_6_months",
      expectedValue: "this_month|within_3_months",
    });
    expect(errors).toEqual([]);
  });

  it("rejects an enum with no options vocabulary", () => {
    const errors = validateCriterionInput({ ...valid, type: "enum", options: null, expectedValue: "ceramic" });
    expect(errors.map((e) => e.field)).toContain("options");
  });

  it("rejects an expected value outside the options and names it", () => {
    const errors = validateCriterionInput({
      ...valid,
      type: "enum",
      options: "ceramic|metal",
      expectedValue: "ceramic|slab",
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ field: "expectedValue" });
    expect(errors[0]?.message).toContain("slab");
  });

  it("rejects options on a non-enum criterion", () => {
    const errors = validateCriterionInput({ ...valid, type: "numeric", expectedValue: ">= 300", options: "a|b" });
    expect(errors.map((e) => e.field)).toEqual(["options"]);
  });
});
