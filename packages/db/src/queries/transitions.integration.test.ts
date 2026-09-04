import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client";
import { openTestDb } from "../test/harness";
import { createLeadIfNew } from "./intake";
import { getLeadById } from "./leads";
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

async function newLead(phone = "11 98842-1170") {
  const r = await createLeadIfNew(db, { name: "Test", email: "t@e.com", phone, preferredCallLanguage: "pt" });
  if (!r.ok) throw new Error("setup");
  return r.value.lead;
}

describe("applyLeadTransition", () => {
  it("dispatches new -> calling and clears next_call_at", async () => {
    const lead = await newLead();
    const r = await applyLeadTransition(db, lead.id, { type: "dispatch" });
    expect(r.ok && r.lead.status).toBe("calling");
    expect(r.ok && r.lead.nextCallAt).toBeNull();
  });

  it("records attempt_count and schedules retry through the patch", async () => {
    const lead = await newLead();
    await applyLeadTransition(db, lead.id, { type: "dispatch" });
    const next = new Date(Date.now() + 15 * 60_000);
    const r = await applyLeadTransition(
      db,
      lead.id,
      { type: "attempt_ended", outcome: "no_answer", attemptCount: 1 },
      { nextCallAt: next },
    );
    expect(r.ok && r.lead).toMatchObject({ status: "waiting_retry", attemptCount: 1 });
    expect(r.ok && r.lead.nextCallAt?.getTime()).toBe(next.getTime());
  });

  it("rejects illegal transitions and leaves the row unchanged", async () => {
    const lead = await newLead();
    const r = await applyLeadTransition(db, lead.id, { type: "attempt_ended", outcome: "no_answer", attemptCount: 1 });
    expect(r.ok).toBe(false);
    expect((await getLeadById(db, lead.id))?.status).toBe("new");
  });

  it("returns not_found for an unknown id", async () => {
    const r = await applyLeadTransition(db, "00000000-0000-0000-0000-000000000000", { type: "dispatch" });
    expect(r).toEqual({ ok: false, error: { code: "not_found" } });
  });

  it("opt_out wins against a concurrent no_answer", async () => {
    const lead = await newLead();
    await applyLeadTransition(db, lead.id, { type: "dispatch" });

    const [a, b] = await Promise.all([
      applyLeadTransition(db, lead.id, { type: "opt_out" }),
      applyLeadTransition(db, lead.id, { type: "attempt_ended", outcome: "no_answer", attemptCount: 1 }),
    ]);

    const final = await getLeadById(db, lead.id);
    expect(final?.status).toBe("opt_out");
    expect(final?.optOutAt).not.toBeNull();
    expect(final?.nextCallAt).toBeNull();
    // Whichever ran second either lost (terminal rejection) or was overtaken by opt_out; never both succeed into a non-opt_out state.
    const successes = [a, b].filter((r) => r.ok);
    expect(successes.length).toBeGreaterThanOrEqual(1);
    if (successes.length === 2) {
      expect(successes.map((r) => (r.ok ? r.lead.status : "")).includes("opt_out")).toBe(true);
    }
  });
});
