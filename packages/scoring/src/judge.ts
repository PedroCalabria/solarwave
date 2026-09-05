import { generateStructured, type AiError, type LanguageModel } from "@solarwave/ai";
import { err, ok, type Result } from "@solarwave/core";
import { z } from "zod";
import {
  GUARDRAIL_DESCRIPTION,
  GUARDRAIL_KEYS,
  isGuardrailKey,
  severityOf,
  type GuardrailKey,
  type Severity,
} from "./guardrails";
import { renderTranscript, verifiedEvidence, type TranscriptTurn } from "./transcript";

export type Finding = {
  guardrail: GuardrailKey;
  severity: Severity;
  evidence: string | null;
};

export type JudgeError = { kind: "model"; error: AiError };

const findingSchema = z.object({
  findings: z
    .array(
      z.object({
        guardrail: z.string().describe("The key of the guardrail that was broken."),
        evidence: z.string().describe("The exact line from the transcript that breaks it."),
      }),
    )
    .describe("Every guardrail broken in this call. Empty when the call was clean."),
});

const SYSTEM = [
  "You audit a completed solar sales call for guardrail violations.",
  "",
  "You are given a transcript and a list of guardrails. Report only violations you can point at with a",
  "line from the transcript. Do not report a violation because a topic came up: the lead may ask about",
  "anything, and only what the AGENT said can break a guardrail. The single exception is opt_out_missed,",
  "which is about what the LEAD said.",
  "",
  "Never invent a quote. If you cannot quote the line, do not report the violation.",
  "Do not report the same guardrail twice. Do not assign severity; that is not yours to decide.",
  "",
  "Guardrails:",
  ...GUARDRAIL_KEYS.map((k) => `- ${k}: ${GUARDRAIL_DESCRIPTION[k]}`),
].join("\n");

export type JudgeInput = {
  model: LanguageModel;
  transcript: TranscriptTurn[];
  /** True when the call already ended as an opt-out, so the safety net is not needed. */
  optOutAlreadyRecorded: boolean;
  maxRetries?: number;
};

/**
 * The post-call guardrail audit.
 *
 * Runs independently of extraction and scoring, so a judge failure cannot
 * discard answers or a computed score. Severity comes from the fixed table,
 * never from the model.
 */
export async function judgeTranscript(input: JudgeInput): Promise<Result<Finding[], JudgeError>> {
  const result = await generateStructured({
    model: input.model,
    schema: findingSchema,
    system: SYSTEM,
    prompt: ["Transcript:", renderTranscript(input.transcript)].join("\n"),
    maxRetries: input.maxRetries,
  });
  if (!result.ok) return err({ kind: "model", error: result.error });

  const raw = (result.value as { findings?: { guardrail: string; evidence: string }[] }).findings ?? [];
  const seen = new Set<GuardrailKey>();
  const findings: Finding[] = [];

  for (const item of raw) {
    const key = item.guardrail?.trim();
    // A key outside the table is discarded rather than stored: an unknown
    // guardrail has no severity and nothing in the portal could act on it.
    if (!key || !isGuardrailKey(key)) continue;
    if (seen.has(key)) continue;
    // The live agent already handled it; a second record would be noise.
    if (key === "opt_out_missed" && input.optOutAlreadyRecorded) continue;

    seen.add(key);
    findings.push({
      guardrail: key,
      severity: severityOf(key),
      evidence: verifiedEvidence(item.evidence, input.transcript),
    });
  }

  return ok(findings);
}
