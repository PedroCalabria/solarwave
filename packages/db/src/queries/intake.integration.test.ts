import { localToInstant } from "@solarwave/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client";
import { openTestDb } from "../test/harness";
import { createLeadIfNew } from "./intake";
import { applyLeadTransition } from "./transitions";

let db: Db;
let truncate: () => Promise<void>;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, truncate, close } = await openTestDb());
});
afterAll(async () => {
  await close();
});
beforeEach(async () => {
  await truncate();
});

const base = { name: "Maria Oliveira", email: "Maria@Email.com", preferredCallLanguage: "pt" as const };

describe("createLeadIfNew", () => {
  it("creates a lead with E.164 phone, DDD, timezone and next_call_at inside the window", async () => {
    const now = localToInstant({ year: 2026, month: 9, day: 3, hour: 14, minute: 30 }, "America/Sao_Paulo");
    const r = await createLeadIfNew(db, { ...base, phone: "(11) 98842-1170", now });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe("created");
    expect(r.value.lead).toMatchObject({
      phone: "+5511988421170",
      ddd: "11",
      timezone: "America/Sao_Paulo",
      status: "new",
      email: "maria@email.com",
      preferredCallLanguage: "pt",
    });
    expect(r.value.lead.nextCallAt?.getTime()).toBe(now.getTime());
  });

  it("pushes a late submission to 08:00 next day in the lead's zone", async () => {
    const now = localToInstant({ year: 2026, month: 9, day: 3, hour: 23, minute: 10 }, "America/Manaus");
    const r = await createLeadIfNew(db, { ...base, phone: "+55 92 99123-4567", now });
    expect(r.ok && r.value.lead.timezone).toBe("America/Manaus");
    const expected = localToInstant({ year: 2026, month: 9, day: 4, hour: 8, minute: 0 }, "America/Manaus");
    expect(r.ok && r.value.lead.nextCallAt?.getTime()).toBe(expected.getTime());
  });

  it("returns the existing lead untouched for a duplicate phone", async () => {
    const first = await createLeadIfNew(db, { ...base, phone: "11 98842-1170" });
    const second = await createLeadIfNew(db, { ...base, name: "Someone Else", phone: "+5511988421170" });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.status).toBe("existing");
    expect(second.value.lead.id).toBe(first.value.lead.id);
    expect(second.value.lead.name).toBe("Maria Oliveira");
    expect(second.value.lead.nextCallAt?.getTime()).toBe(first.value.lead.nextCallAt?.getTime());
  });

  it("never re-schedules an opted-out lead", async () => {
    const first = await createLeadIfNew(db, { ...base, phone: "11 98842-1170" });
    if (!first.ok) throw new Error("setup");
    const optOut = await applyLeadTransition(db, first.value.lead.id, { type: "opt_out" });
    expect(optOut.ok && optOut.lead.status).toBe("opt_out");

    const again = await createLeadIfNew(db, { ...base, phone: "11 98842-1170" });
    expect(again.ok && again.value.status).toBe("existing");
    expect(again.ok && again.value.lead.status).toBe("opt_out");
    expect(again.ok && again.value.lead.nextCallAt).toBeNull();
  });

  it("rejects a non-Brazilian number", async () => {
    const r = await createLeadIfNew(db, { ...base, phone: "+1 512 555 0148" });
    expect(r).toEqual({ ok: false, error: { field: "phone", error: "not_brazil" } });
  });

  it("keeps exactly one row under concurrent submissions", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        createLeadIfNew(db, { ...base, name: `Racer ${i}`, phone: "(21) 99135-4402" }),
      ),
    );
    const created = results.filter((r) => r.ok && r.value.status === "created");
    const existing = results.filter((r) => r.ok && r.value.status === "existing");
    expect(created).toHaveLength(1);
    expect(existing).toHaveLength(5);
    const ids = new Set(results.map((r) => (r.ok ? r.value.lead.id : "err")));
    expect(ids.size).toBe(1);
  });
});
