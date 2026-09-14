import { describe, expect, it } from "vitest";
import { SETTING_KEYS } from "../schema";
import { isBooleanSetting, validateSetting } from "./settings";

describe("validateSetting", () => {
  it("accepts a threshold in range", () => {
    expect(validateSetting(SETTING_KEYS.handoffThreshold, 65)).toBeNull();
    expect(validateSetting(SETTING_KEYS.handoffThreshold, 0)).toBeNull();
    expect(validateSetting(SETTING_KEYS.handoffThreshold, 100)).toBeNull();
  });

  it("rejects a threshold out of range or non-integer", () => {
    expect(validateSetting(SETTING_KEYS.handoffThreshold, 101)).not.toBeNull();
    expect(validateSetting(SETTING_KEYS.handoffThreshold, -1)).not.toBeNull();
    expect(validateSetting(SETTING_KEYS.handoffThreshold, 70.5)).not.toBeNull();
  });

  it("validates the answered-weight share as 0..1", () => {
    expect(validateSetting(SETTING_KEYS.minAnsweredWeightShare, 0.6)).toBeNull();
    expect(validateSetting(SETTING_KEYS.minAnsweredWeightShare, 1.2)).not.toBeNull();
    expect(validateSetting(SETTING_KEYS.minAnsweredWeightShare, Number.NaN)).not.toBeNull();
  });
});

describe("validateSetting — the operational envelope", () => {
  it("accepts a switch as a boolean and refuses it as a number", () => {
    expect(validateSetting(SETTING_KEYS.autoDispatchEnabled, true)).toBeNull();
    expect(validateSetting(SETTING_KEYS.autoDispatchEnabled, false)).toBeNull();
    // 0 and 1 are the tempting representation and the one this change refuses:
    // an audit entry reading "0 -> 1" hides what was actually turned on.
    expect(validateSetting(SETTING_KEYS.autoDispatchEnabled, 1)).not.toBeNull();
  });

  it("refuses a boolean where a number belongs", () => {
    expect(validateSetting(SETTING_KEYS.handoffThreshold, true)).not.toBeNull();
    expect(validateSetting(SETTING_KEYS.dailyCallBudget, false)).not.toBeNull();
  });

  it("accepts whole, non-negative budgets", () => {
    expect(validateSetting(SETTING_KEYS.dailyCallBudget, 0)).toBeNull();
    expect(validateSetting(SETTING_KEYS.dailyCallBudget, 10)).toBeNull();
    expect(validateSetting(SETTING_KEYS.monthlyVoiceSecondsBudget, 4500)).toBeNull();
  });

  it("refuses a negative or fractional budget, naming the field", () => {
    const negative = validateSetting(SETTING_KEYS.dailyCallBudget, -1);
    expect(negative?.field).toBe(SETTING_KEYS.dailyCallBudget);
    expect(validateSetting(SETTING_KEYS.dailyCallBudget, 2.5)).not.toBeNull();
    expect(validateSetting(SETTING_KEYS.monthlyVoiceSecondsBudget, -60)).not.toBeNull();
    expect(validateSetting(SETTING_KEYS.monthlyVoiceSecondsBudget, 1.5)).not.toBeNull();
  });

  it("knows which keys are switches", () => {
    expect(isBooleanSetting(SETTING_KEYS.autoDispatchEnabled)).toBe(true);
    expect(isBooleanSetting(SETTING_KEYS.dailyCallBudget)).toBe(false);
    expect(isBooleanSetting(SETTING_KEYS.handoffThreshold)).toBe(false);
  });
});
