import { describe, expect, it } from "vitest";
import { normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it("normalises a national mobile number with punctuation", () => {
    const r = normalizePhone("(11) 98842-1170");
    expect(r).toEqual({ ok: true, value: { e164: "+5511988421170", ddd: "11", national: "11988421170" } });
  });

  it("accepts an explicit +55 prefix", () => {
    const r = normalizePhone("+55 21 99135-4402");
    expect(r.ok && r.value.e164).toBe("+5521991354402");
    expect(r.ok && r.value.ddd).toBe("21");
  });

  it("accepts a landline with 8 digits after the DDD", () => {
    const r = normalizePhone("11 3456 7890");
    expect(r.ok && r.value.e164).toBe("+551134567890");
  });

  it("drops a national trunk prefix 0", () => {
    const r = normalizePhone("011 98842-1170");
    expect(r.ok && r.value.e164).toBe("+5511988421170");
  });

  it("rejects a US number in phase 1", () => {
    const r = normalizePhone("+1 512 555 0148");
    expect(r).toEqual({ ok: false, error: "not_brazil" });
  });

  it("rejects too-short input", () => {
    expect(normalizePhone("12345").ok).toBe(false);
  });

  it("rejects garbage", () => {
    expect(normalizePhone("call me").ok).toBe(false);
  });
});
