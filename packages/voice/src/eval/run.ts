/**
 * The guardrail probes, run against the model that actually speaks.
 *
 * Change 3's design said it in as many words: "a green suite here does not
 * certify the voice call", and promised change 4 would re-run the probe subset
 * over the voice path. This is that.
 *
 *   pnpm eval:voice
 *   pnpm eval:voice -- --probe no_prices_or_savings
 *
 * NOT part of `pnpm eval:agent` and not in CI (design D8 of change 3, task
 * 12.3). The text suite is cheap and runs on a text quota; this opens one
 * realtime session per probe against a free tier whose realtime limits are
 * separate and unmeasured. Mixing them would make a cheap command expensive.
 *
 * What this covers: what the voice model SAYS when provoked, with the voice
 * frame and the real tool declarations. What it does not: prosody, latency,
 * barge-in, and anything that only breaks once real audio is flowing. Those
 * belong to the harness, and are honestly still open (tasks 7b).
 */
import { requireApiKey, requireModelId, modelFor, assertConfiguredModels } from "@solarwave/ai";
import type { ScriptCriterion } from "@solarwave/agent";
import { JUDGED, PROBES, judgeAgentTurn, type JudgedGuardrail } from "@solarwave/agent/eval";
import { CRITERIA as SEED_CRITERIA } from "@solarwave/db/seed";
import { geminiTransport } from "../transport";
import { runVoiceProbe, type VoiceProbeRun } from "./voiceProbe";

/** The seeded criteria, so the eval measures the configuration the demo runs. */
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

/** Between sessions. Realtime quota is metered differently from text quota. */
const DELAY_MS = Number(process.env.EVAL_VOICE_DELAY_MS ?? 4000);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function argOf(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const only = argOf("--probe");
  const probes = only ? PROBES.filter((p) => p.key === only) : PROBES;
  if (probes.length === 0) {
    console.error(`No probe named "${only}". Known: ${PROBES.map((p) => p.key).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  await assertConfiguredModels();
  const model = requireModelId("voice");
  const transport = geminiTransport(requireApiKey());
  const judgeModel = modelFor("judge");

  console.log(`voice pass — ${model}`);
  console.log(`${probes.length} probe${probes.length === 1 ? "" : "s"}, one realtime session each\n`);

  const runs: VoiceProbeRun[] = [];
  for (const [index, probe] of probes.entries()) {
    if (index > 0) await sleep(DELAY_MS);

    const run = await runVoiceProbe({ transport, model, criteria: CRITERIA, probe });

    // Two guardrails are graded on quality by a model, on top of a
    // deterministic assertion that has already passed (change 3, design D6).
    if (!run.notRun && run.check.passed && probe.key in JUDGED) {
      const leadTurn = probe.history.at(-1)?.text ?? "";
      run.check = await judgeAgentTurn(judgeModel, probe.key as JudgedGuardrail, leadTurn, run.text);
    }

    runs.push(run);
    console.log(`${mark(run)} ${probe.key.padEnd(28)} ${run.seconds}s  ${detail(run)}`);
  }

  report(runs);
}

function mark(run: VoiceProbeRun): string {
  if (run.notRun) return "-";
  return run.check.passed ? "ok  " : "FAIL";
}

function detail(run: VoiceProbeRun): string {
  if (run.notRun) return `not run: ${run.notRun}`;
  const tools = run.toolCalls.length > 0 ? ` [${run.toolCalls.map((t) => t.name).join(", ")}]` : "";
  return `${run.check.detail}${tools}`;
}

function report(runs: VoiceProbeRun[]) {
  const notRun = runs.filter((r) => r.notRun);
  const scored = runs.filter((r) => !r.notRun);
  const failed = scored.filter((r) => !r.check.passed);
  const seconds = runs.reduce((total, r) => total + r.seconds, 0);

  console.log(`\n${"".padEnd(60, "-")}`);
  console.log(`held      ${scored.length - failed.length} of ${scored.length} scored`);
  console.log(`not run   ${notRun.length}`);
  console.log(`sessions  ${runs.length}, ${Math.round(seconds)}s of realtime`);

  if (failed.length > 0) {
    console.log("\nfailures:");
    for (const run of failed) {
      console.log(`  ${run.probe.key}: ${run.check.detail}`);
      if (run.text) console.log(`    said: "${run.text.slice(0, 160)}"`);
    }
  }

  if (notRun.length > 0) {
    // A refused session is a quota or transport problem, never a guardrail
    // failure, and reporting it as one would be a lie about the agent.
    console.log("\nnot run (quota or transport, NOT guardrail failures):");
    for (const run of notRun) console.log(`  ${run.probe.key}: ${run.notRun}`);
  }

  process.exitCode = failed.length > 0 ? 1 : 0;
}

void main();
