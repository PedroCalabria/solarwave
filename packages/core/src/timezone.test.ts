import { describe, expect, it } from "vitest";
import { dddToTimezone, isValidDdd } from "./timezone";

describe("dddToTimezone", () => {
  it.each([
    ["11", "America/Sao_Paulo"],
    ["21", "America/Sao_Paulo"],
    ["85", "America/Sao_Paulo"],
    ["65", "America/Cuiaba"],
    ["66", "America/Cuiaba"],
    ["67", "America/Campo_Grande"],
    ["92", "America/Manaus"],
    ["97", "America/Manaus"],
    ["95", "America/Boa_Vista"],
    ["69", "America/Porto_Velho"],
    ["68", "America/Rio_Branco"],
  ])("maps DDD %s to %s", (ddd, tz) => {
    expect(dddToTimezone(ddd)).toEqual({ ok: true, value: tz });
  });

  it("rejects an unassigned DDD", () => {
    expect(dddToTimezone("20")).toEqual({ ok: false, error: "unknown_ddd" });
    expect(dddToTimezone("00")).toEqual({ ok: false, error: "unknown_ddd" });
    expect(isValidDdd("23")).toBe(false);
  });
});
