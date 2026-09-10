import {
  SETTING_KEYS,
  applyLeadTransition,
  callAttempts,
  closeDb,
  employees,
  getLeadById,
  leads,
  updateSetting,
  type Db,
} from "@solarwave/db";
import { openTestDb } from "@solarwave/db/test";
import { waitForSleep } from "@workflow/vitest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getRun, start } from "workflow/api";
import { leadWorkflow } from "./lead";

/**
 * `leadWorkflow`, orchestrated for real (lifecycle-and-operations task 6.6).
 *
 * Every case here is a path that places NO telephone call, and that is a
 * deliberate limit rather than a gap: a workflow test that dials is a workflow
 * test that spends Twilio minutes out of an allowance of seventy-five. What
 * dispatch-through does is proven where it can be proven for free — at the step
 * and database layers, and end to end with simulated calls in section 9.
 *
 * Two independent guards keep it that way. Automatic dispatch is off, and the
 * daily call budget is zero, so even a path that reached the reserving
 * transaction would be refused before `calls.create`.
 */

const hasDb = Boolean(process.env.DATABASE_URL ?? process.env.POSTGRES_URL);

/**
 * BLOCKED UPSTREAM, 2026-09-07, and deliberately not deleted.
 *
 * `@workflow/vitest` cannot run here: the Local World's queue fails every
 * enqueue with
 *
 *   TypeError: Module ".../builtin-modules/builtin-modules.json"
 *              needs an import attribute of "type: json"
 *
 * so no step ever executes and every run hangs. `builtin-modules` is a
 * transitive dependency of `@workflow/builders`; the file is imported without
 * Node 22's required `with { type: "json" }` attribute. Reproduced on 5.0.0 and
 * on 5.3.0 via a pnpm override, so it is not a stale pin.
 *
 * Scope of the damage, measured rather than assumed: this affects ONLY the
 * in-process test runtime. Spike 1.2 ran real workflows under both `next dev`
 * and `vercel dev` — builder, suspend, resume and a Postgres read from inside a
 * step — so the product path is unaffected.
 *
 * What this suite would prove is covered meanwhile by
 * `steps.integration.test.ts`, at the layer where the guards actually live: the
 * opt-out refusal, the automatic-dispatch refusal, the terminal-lead exit and
 * the "writes no lifecycle state" claim are all asserted there against real
 * Postgres. What stays unproven is the LOOP WIRING — that the workflow calls
 * those steps in the order the design says. Section 9.2 exercises that end to
 * end with simulated calls.
 *
 * Set WORKFLOW_ORCHESTRATION_TESTS=1 to run it once the upstream import is fixed.
 */
const orchestrationRunnable = process.env.WORKFLOW_ORCHESTRATION_TESTS === "1";

describe.skipIf(!hasDb || !orchestrationRunnable)("leadWorkflow", () => {
  let db: Db;
  let truncate: () => Promise<void>;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, truncate, close } = await openTestDb());
  });
  afterAll(async () => {
    await close();
    await closeDb();
  });
  beforeEach(async () => {
    await truncate();
    await seedAdmin();
    await setOperations({ enabled: false, dailyBudget: 0 });
  });

  const LEAD_ID = "11111111-1111-1111-1111-111111111111";
  const ADMIN_ID = "55555555-5555-5555-5555-555555555555";
  const SOON = () => new Date(Date.now() + 60 * 60 * 1000);

  async function seedAdmin() {
    await db
      .insert(employees)
      .values({ id: ADMIN_ID, name: "Lucas", email: "lucas@example.com", role: "admin" })
      .onConflictDoNothing();
  }

  async function setOperations({ enabled, dailyBudget }: { enabled: boolean; dailyBudget: number }) {
    await updateSetting(db, SETTING_KEYS.autoDispatchEnabled, enabled, ADMIN_ID);
    await updateSetting(db, SETTING_KEYS.dailyCallBudget, dailyBudget, ADMIN_ID);
  }

  async function seedLead(status: "new" | "waiting_retry" | "opt_out" | "qualified", nextCallAt: Date | null) {
    await db.insert(leads).values({
      id: LEAD_ID,
      name: "Ana Souza",
      email: "ana@example.com",
      phone: "+5511999990000",
      ddd: "11",
      timezone: "America/Sao_Paulo",
      preferredCallLanguage: "pt",
      status,
      nextCallAt,
    });
  }

  const attempts = () => db.select().from(callAttempts);

  it("ends immediately for a lead that is already terminal", async () => {
    await seedLead("qualified", SOON());

    const run = await start(leadWorkflow, [LEAD_ID]);
    const result = (await run.returnValue) as { dispatched: number; ended: string };

    expect(result).toMatchObject({ dispatched: 0, ended: "qualified" });
    expect(await attempts()).toHaveLength(0);
    expect(await run.status).toBe("completed");
  });

  it("ends immediately for a lead with nothing scheduled", async () => {
    // A guardrail or a terminal score cleared `next_call_at`. The run does not
    // get to second-guess either of them.
    await seedLead("waiting_retry", null);

    const result = (await start(leadWorkflow, [LEAD_ID]).then((r) => r.returnValue)) as { ended: string };
    expect(result.ended).toBe("unscheduled");
    expect(await attempts()).toHaveLength(0);
  });

  it("ends for a lead that vanished", async () => {
    const result = (await start(leadWorkflow, [LEAD_ID]).then((r) => r.returnValue)) as { ended: string };
    expect(result.ended).toBe("gone");
  });

  it("NEVER dispatches for a lead that opted out while the run was asleep", async () => {
    // Spec section 6, and the reason the run re-reads after the sleep rather
    // than trusting the snapshot it took before it.
    await seedLead("waiting_retry", SOON());
    const run = await start(leadWorkflow, [LEAD_ID]);

    const sleepId = await waitForSleep(run);
    await applyLeadTransition(db, LEAD_ID, { type: "opt_out" });
    await getRun(run.runId).wakeUp({ correlationIds: [sleepId] });

    const result = (await run.returnValue) as { dispatched: number; ended: string };
    expect(result).toMatchObject({ dispatched: 0, ended: "opt_out" });
    expect(await attempts()).toHaveLength(0);
    expect((await getLeadById(db, LEAD_ID))?.status).toBe("opt_out");
  });

  it("backs off rather than ending when automatic dispatch is off", async () => {
    await seedLead("waiting_retry", SOON());
    const run = await start(leadWorkflow, [LEAD_ID]);

    // First sleep: waiting for the scheduled call time.
    await getRun(run.runId).wakeUp({ correlationIds: [await waitForSleep(run)] });

    // The dispatch is refused, and the run sleeps AGAIN rather than exiting —
    // the switch is temporary, and a lead must still be callable once someone
    // turns it on.
    const backoff = await waitForSleep(run);
    expect(backoff).toBeTruthy();
    expect(await attempts()).toHaveLength(0);

    // Nothing was written. This is D3's reversibility claim, at the run level.
    const lead = await getLeadById(db, LEAD_ID);
    expect(lead?.status).toBe("waiting_retry");
    expect(lead?.attemptCount).toBe(0);
    expect(lead?.score).toBeNull();

    await getRun(run.runId).cancel?.();
  });

  it("gives up after a bounded number of temporary refusals", async () => {
    // A switch that stays off for a month must not spin forever: the run ends
    // and leaves the lead to the daily sweep.
    await seedLead("waiting_retry", new Date(Date.now() - 60_000));
    const run = await start(leadWorkflow, [LEAD_ID]);

    for (let i = 0; i < 40; i += 1) {
      const status = await run.status;
      if (status !== "running" && status !== "pending") break;
      const sleepId = await waitForSleep(run).catch(() => null);
      if (!sleepId) break;
      await getRun(run.runId).wakeUp({ correlationIds: [sleepId] });
    }

    const result = (await run.returnValue) as { dispatched: number; ended: string };
    expect(result.dispatched).toBe(0);
    expect(result.ended).toContain("gave_up");
    expect(await attempts()).toHaveLength(0);
  });
});
