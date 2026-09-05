/**
 * The conversation agent's persona evaluation.
 *
 * Deliberately not part of `pnpm test`: real calls are slow, cost requests
 * against a free-tier quota and flake, which would erode trust in the suite
 * (design D8, extending D14 of `scoring-worker`). CI runs the mocked tests;
 * this runs on demand.
 *
 *   pnpm eval:agent
 *   pnpm eval:agent -- --scenario opt_out
 *
 * Budget: roughly 45 requests. Thirteen probes cost one request each, two of
 * them add a judge call, and the four full flows use scripted personas so only
 * the agent spends anything.
 */
import { assertConfiguredModels, modelFor, requireModelId } from "@solarwave/ai";
import { CRITERIA as SEED_CRITERIA } from "@solarwave/db/seed";
import type { ScriptCriterion } from "../criteria";
import { JUDGED, judgeAgentTurn, type JudgedGuardrail } from "./judge";
import { PROBES, runProbe } from "./probes";
import { SCENARIOS, runScenario } from "./scenarios";

/**
 * The seeded criteria, read straight from the seed rather than restated here.
 *
 * They are the same rows the scoring eval grades extraction against and the
 * same ones a demo database holds, so the agent is measured against the
 * configuration the rest of the system actually runs on — and a question edited
 * in the seed cannot silently stop being the question the eval asks.
 */
const CRITERIA: ScriptCriterion[] = SEED_CRITERIA.map((c) => ({
  key: c.key,
  label: c.label,
  questionPt: c.questionPt,
  questionEn: c.questionEn,
  type: c.type,
  options: c.options,
  expectedValue: c.expectedValue,
  weight: c.weight,
  blocking: c.blocking,
  active: c.active,
  sortOrder: c.sortOrder,
}));

/**
 * The free tier rations requests. The scoring eval measured its pacing at 13
 * seconds and this one keeps it, so a run takes about ten minutes rather than
 * failing halfway through and reporting the impatience as a defect.
 */
const DELAY_MS = Number(process.env.EVAL_DELAY_MS ?? 13_000);
const pace = () => new Promise((resolve) => setTimeout(resolve, DELAY_MS));

/** How many turns after a hostile utterance still counts as ending promptly. */
const HOSTILE_BUDGET = Number(process.env.EVAL_HOSTILE_TURNS ?? 2);

function filterArg(): string | null {
  const at = process.argv.indexOf("--scenario");
  return at >= 0 ? (process.argv[at + 1] ?? null) : null;
}

async function main() {
  await assertConfiguredModels();

  const only = filterArg();
  const conversationId = requireModelId("conversation");
  console.log(
    `conversation: ${conversationId}\n` +
      `pacing:       ${DELAY_MS}ms between calls\n` +
      `hostile exit: within ${HOSTILE_BUDGET} turn(s)\n` +
      (only ? `filter:       ${only}\n` : ""),
  );

  // Must go through `modelFor`: a bare model-id string is routed through the
  // Vercel AI Gateway by the SDK, which this project cannot use.
  const model = modelFor("conversation");
  const judge = modelFor("judge");

  const probes = PROBES.filter((p) => !only || p.key === only);
  const scenarios = SCENARIOS.filter((s) => !only || s.key === only);
  let requests = 0;

  let passed = 0;
  if (probes.length > 0) {
    console.log(`\nGuardrail probes — one agent turn each, ${probes.length} of them\n`);
    for (const probe of probes) {
      if (requests > 0) await pace();
      const run = await runProbe(model, CRITERIA, probe);
      requests += 1;
      if (run.check.passed) passed += 1;
      console.log(`  ${probe.key.padEnd(26)} ${run.check.passed ? "held  " : "BROKE "} ${run.check.detail}`);
      if (run.error) console.log(`    ${run.error}`);

      // Only two behaviours reach a judge, and only after their deterministic
      // gate has already passed: it grades quality, it does not replace a check
      // that a string could have made (design D6).
      if (run.check.passed && probe.key in JUDGED) {
        await pace();
        const leadTurn = probe.history.filter((t) => t.who === "lead").at(-1)?.text ?? "";
        const verdict = await judgeAgentTurn(judge, probe.key as JudgedGuardrail, leadTurn, run.text);
        requests += 1;
        console.log(`    judged: ${verdict.passed ? "ok" : "POOR"} — ${verdict.detail}`);
      }
    }
    console.log(`\n  ${passed}/${probes.length} guardrails held.`);
  }

  if (scenarios.length > 0) {
    console.log(`\nFull flows — scripted personas, only the agent spends requests\n`);
    for (const scenario of scenarios) {
      if (requests > 0) await pace();
      const run = await runScenario(model, CRITERIA, scenario, HOSTILE_BUDGET);
      requests += run.turnsUsed || 1;

      if (run.error) {
        console.log(`  ${scenario.key.padEnd(14)} FAILED — ${run.error}`);
        continue;
      }
      console.log(
        `  ${scenario.key.padEnd(14)} ${run.outcome} ` +
          `${run.outcomeMatched ? "(as expected)" : `(EXPECTED ${scenario.expectedOutcome})`} · ` +
          `${run.turnsUsed} turns · disclosure ${run.disclosure.passed ? "ok" : "MISSING"} · ` +
          `${run.fallbacks} persona fallback(s)`,
      );
      if (run.hostileExit) {
        // The design left "N" open on purpose: it wanted one real conversation
        // to calibrate rather than a number invented at design time.
        console.log(
          `    hostile exit: ${run.hostileExit.passed ? "within budget" : "TOO SLOW"} — ${run.hostileExit.detail}`,
        );
      }
      if (process.argv.includes("--verbose")) {
        for (const turn of run.transcript) {
          console.log(`      ${turn.who === "ai" ? "AGENT" : "LEAD "} ${turn.text}`);
        }
      }
      if (run.fallbacks > 0) {
        // A persona that keeps falling back has stopped covering its scenario,
        // and would otherwise pass silently while testing nothing.
        console.log(`    the persona did not recognise ${run.fallbacks} agent turn(s) — check its rules`);
      }
    }
  }

  console.log(`\nSpent roughly ${requests} model requests.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
