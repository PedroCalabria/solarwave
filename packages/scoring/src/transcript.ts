import type { TranscriptTurn } from "@solarwave/db";

export type { TranscriptTurn };

/** The transcript as the model sees it. Stable ordering, no timestamps. */
export function renderTranscript(turns: TranscriptTurn[]): string {
  return turns.map((t) => `${t.who === "ai" ? "AGENT" : "LEAD"}: ${t.text}`).join("\n");
}

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Whether a quote actually appears in the transcript.
 *
 * Evidence exists so a human can check the answer against what was said. A
 * paraphrase that reads like a quote is worse than no quote at all, so the
 * worker verifies rather than trusting the model.
 */
export function isVerbatim(evidence: string, turns: TranscriptTurn[]): boolean {
  const needle = normalise(evidence);
  if (needle.length === 0) return false;
  return turns.some((t) => normalise(t.text).includes(needle));
}

/**
 * Keeps evidence only when it is genuinely quoted. A paraphrase is dropped
 * rather than stored, because the portal presents evidence as the lead's own
 * words. The answer itself survives; only the unverifiable quote does not.
 */
export function verifiedEvidence(evidence: string | null | undefined, turns: TranscriptTurn[]): string | null {
  if (!evidence) return null;
  return isVerbatim(evidence, turns) ? evidence : null;
}
