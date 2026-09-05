import { getDb, listViolations } from "@solarwave/db";
import { GUARDRAIL_DESCRIPTION, blocksOutreach, isGuardrailKey } from "@solarwave/scoring";
import { ViolationsView, type ViolationItem } from "@/components/app/ViolationsView";
import { requireEmployee } from "@/lib/auth";

export const dynamic = "force-dynamic";

function formatDate(value: Date | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: process.env.PORTAL_TIMEZONE ?? "America/Sao_Paulo",
  }).format(value);
}

export default async function ViolationsPage() {
  await requireEmployee();

  const rows = await listViolations(getDb());
  const violations: ViolationItem[] = rows.map((row) => ({
    id: row.id,
    guardrail: row.guardrail,
    severity: row.severity,
    evidence: row.evidence,
    createdAt: formatDate(row.createdAt),
    reviewedAt: row.reviewedAt ? formatDate(row.reviewedAt) : null,
    reviewerName: row.reviewerName,
    leadId: row.leadId,
    leadName: row.leadName,
    attemptNumber: row.attemptNumber,
    description: isGuardrailKey(row.guardrail)
      ? GUARDRAIL_DESCRIPTION[row.guardrail]
      : "Unrecognised guardrail key.",
    blocksOutreach: isGuardrailKey(row.guardrail) && blocksOutreach(row.guardrail),
  }));

  const unreviewed = violations.filter((v) => !v.reviewedAt).length;

  return (
    <main style={{ padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
      <header style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        <h1 style={{ margin: 0, fontSize: "var(--title-1)" }}>Guardrails</h1>
        <p style={{ margin: 0, fontSize: "var(--body-2)", color: "var(--text-muted)" }}>
          What the post-call audit found in the transcripts, newest first.
          {unreviewed > 0 ? ` ${unreviewed} still waiting for review.` : " Everything has been reviewed."}
        </p>
      </header>

      <ViolationsView violations={violations} />
    </main>
  );
}
