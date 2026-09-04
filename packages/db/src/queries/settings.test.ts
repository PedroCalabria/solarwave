import { describe, expect, it } from "vitest";
import { SETTING_KEYS } from "../schema";
import { validateSetting } from "./settings";

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
