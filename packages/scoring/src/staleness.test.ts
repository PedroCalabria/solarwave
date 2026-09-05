import { describe, expect, it } from "vitest";
import { classifyChange, classifyChanges, classifyStaleness, type AuditChange } from "./staleness";

const change = (field: string, oldValue: string | null = null, newValue: string | null = null): AuditChange => ({
  field,
  oldValue,
  newValue,
});

describe("classifyChange", () => {
  it("re-scores for weight, blocking and sort order", () => {
    expect(classifyChange(change("weight", "20", "25"))).toBe("rescore");
    expect(classifyChange(change("blocking", "false", "true"))).toBe("rescore");
    expect(classifyChange(change("sortOrder", "1", "2"))).toBe("rescore");
  });

  it("re-scores for either setting", () => {
    expect(classifyChange(change("setting:handoff_threshold", "70", "60"))).toBe("rescore");
    expect(classifyChange(change("setting:min_answered_weight_share", "0.6", "0.5"))).toBe("rescore");
  });

  it("re-scores when a criterion is deleted or deactivated", () => {
    expect(classifyChange(change("deleted", "roof_type", null))).toBe("rescore");
    expect(classifyChange(change("active", "true", "false"))).toBe("rescore");
  });

  it("reprocesses when a criterion is created or reactivated", () => {
    expect(classifyChange(change("created", null, "roof_area"))).toBe("reprocess");
    expect(classifyChange(change("active", "false", "true"))).toBe("reprocess");
  });

  it("reprocesses when the type or the vocabulary moves", () => {
    expect(classifyChange(change("type", "enum", "free_text"))).toBe("reprocess");
    expect(classifyChange(change("options", "ceramic|metal", "ceramic|metal|slab"))).toBe("reprocess");
  });

  it("re-scores when only which values pass changes", () => {
    // The stored value is still a member of the unchanged vocabulary, so the
    // engine can just re-evaluate it. This is the row the options split moved
    // from the expensive path to the cheap one.
    expect(
      classifyChange(change("expectedValue", "this_month|within_3_months|within_6_months", "this_month|within_3_months")),
    ).toBe("rescore");
    expect(classifyChange(change("expectedValue", ">= 300", ">= 250"))).toBe("rescore");
  });

  it("ignores wording and the key", () => {
    expect(classifyChange(change("questionPt", "a", "b"))).toBe("none");
    expect(classifyChange(change("questionEn", "a", "b"))).toBe("none");
    expect(classifyChange(change("label", "a", "b"))).toBe("none");
    // Answers link to a criterion by id, so renaming the key moves nothing.
    expect(classifyChange(change("key", "roof", "roof_type"))).toBe("none");
  });
});

describe("classifyChanges", () => {
  it("is none when nothing changed", () => {
    expect(classifyChanges([])).toBe("none");
  });

  it("takes the most expensive path among the changes", () => {
    expect(classifyChanges([change("weight", "20", "25"), change("type", "enum", "numeric")])).toBe("reprocess");
    expect(classifyChanges([change("questionPt"), change("weight", "20", "25")])).toBe("rescore");
    expect(classifyChanges([change("questionPt"), change("label")])).toBe("none");
  });

  it("distinguishes widening the vocabulary from narrowing what passes", () => {
    // One save, two audit rows: the vocabulary change is what forces the model.
    expect(
      classifyChanges([
        change("options", "a|b", "a|b|c"),
        change("expectedValue", "a|b", "a"),
      ]),
    ).toBe("reprocess");
    expect(classifyChanges([change("expectedValue", "a|b", "a")])).toBe("rescore");
  });
});

describe("classifyStaleness", () => {
  const scoredAt = new Date("2026-09-01T10:00:00Z");

  it("reports an unscored attempt as never scored, not stale", () => {
    expect(classifyStaleness({ scoredAt: null, changes: [], transcriptAvailable: true })).toEqual({
      state: "never_scored",
    });
  });

  it("is fresh when nothing since scoring affects the score", () => {
    expect(
      classifyStaleness({ scoredAt, changes: [change("questionPt", "a", "b")], transcriptAvailable: true }),
    ).toEqual({ state: "fresh" });
  });

  it("offers the free path for a threshold change", () => {
    expect(
      classifyStaleness({
        scoredAt,
        changes: [change("setting:handoff_threshold", "70", "60")],
        transcriptAvailable: true,
      }),
    ).toEqual({ state: "stale", required: "rescore", available: "rescore" });
  });

  it("offers reprocessing when a criterion was created and the transcript is there", () => {
    expect(
      classifyStaleness({ scoredAt, changes: [change("created", null, "roof_area")], transcriptAvailable: true }),
    ).toEqual({ state: "stale", required: "reprocess", available: "reprocess" });
  });

  it("freezes the score when reprocessing is required but the transcript is gone", () => {
    expect(
      classifyStaleness({ scoredAt, changes: [change("created", null, "roof_area")], transcriptAvailable: false }),
    ).toEqual({ state: "stale", required: "reprocess", available: "none" });
  });

  it("still offers a re-score without a transcript, because it reads answers", () => {
    expect(
      classifyStaleness({ scoredAt, changes: [change("weight", "20", "25")], transcriptAvailable: false }),
    ).toEqual({ state: "stale", required: "rescore", available: "rescore" });
  });
});
