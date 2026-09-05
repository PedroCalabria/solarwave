"use client";

import Link from "next/link";
import { useActionState } from "react";
import { reviewViolationAction, type ScoringActionState } from "@/app/portal/(shell)/scoring-actions";

export type ViolationItem = {
  id: string;
  guardrail: string;
  severity: string;
  evidence: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewerName: string | null;
  leadId: string;
  leadName: string;
  attemptNumber: number;
  description: string;
  blocksOutreach: boolean;
};

const SEVERITY_STYLE: Record<string, { bg: string; fg: string }> = {
  high: { bg: "rgba(220, 38, 38, 0.12)", fg: "#b91c1c" },
  medium: { bg: "rgba(217, 119, 6, 0.12)", fg: "#b45309" },
  low: { bg: "rgba(100, 116, 139, 0.12)", fg: "#475569" },
};

const INITIAL: ScoringActionState = { ok: true, message: "", nonce: 0 };

function ReviewButton({ violationId, leadId }: { violationId: string; leadId: string }) {
  const [state, action, pending] = useActionState(reviewViolationAction, INITIAL);

  return (
    <form action={action} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
      <input type="hidden" name="violationId" value={violationId} />
      <input type="hidden" name="leadId" value={leadId} />
      <button
        type="submit"
        disabled={pending}
        style={{
          padding: "6px 12px",
          borderRadius: "var(--radius-2)",
          border: "1px solid var(--border-subtle)",
          background: "var(--surface-1)",
          color: "var(--text-body)",
          fontSize: "var(--body-3)",
          cursor: pending ? "wait" : "pointer",
        }}
      >
        {pending ? "Marking…" : "Mark reviewed"}
      </button>
      {!state.ok && state.message ? (
        <span style={{ fontSize: "var(--body-3)", color: "#b91c1c" }}>{state.message}</span>
      ) : null}
    </form>
  );
}

export function ViolationsView({ violations }: { violations: ViolationItem[] }) {
  if (violations.length === 0) {
    return (
      <div
        style={{
          padding: "var(--space-6)",
          borderRadius: "var(--radius-3)",
          border: "1px dashed var(--border-subtle)",
          color: "var(--text-muted)",
          fontSize: "var(--body-2)",
        }}
      >
        No guardrail violations recorded. Every audited call has been clean so far.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      {violations.map((v) => {
        const severity = SEVERITY_STYLE[v.severity] ?? SEVERITY_STYLE.low!;
        const blocking = v.blocksOutreach && !v.reviewedAt;

        return (
          <article
            key={v.id}
            style={{
              padding: "var(--space-4)",
              borderRadius: "var(--radius-3)",
              border: `1px solid ${blocking ? severity.fg : "var(--border-subtle)"}`,
              background: "var(--surface-1)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
            }}
          >
            <header style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: "var(--radius-1)",
                  background: severity.bg,
                  color: severity.fg,
                  fontSize: "var(--label-2)",
                  fontWeight: 600,
                  textTransform: "uppercase",
                }}
              >
                {v.severity}
              </span>
              <code style={{ fontFamily: "var(--font-mono)", fontSize: "var(--body-3)" }}>{v.guardrail}</code>
              <Link href={`/portal/leads/${v.leadId}`} style={{ fontSize: "var(--body-3)" }}>
                {v.leadName}
              </Link>
              <span style={{ fontSize: "var(--body-3)", color: "var(--text-muted)" }}>
                attempt {v.attemptNumber} · {v.createdAt}
              </span>
              {blocking ? (
                <span style={{ fontSize: "var(--body-3)", color: severity.fg, fontWeight: 600 }}>
                  Blocking outreach until reviewed
                </span>
              ) : null}
            </header>

            <p style={{ margin: 0, fontSize: "var(--body-3)", color: "var(--text-muted)" }}>{v.description}</p>

            {v.evidence ? (
              <blockquote
                style={{
                  margin: 0,
                  padding: "var(--space-2) var(--space-3)",
                  borderLeft: "3px solid var(--border-subtle)",
                  fontSize: "var(--body-2)",
                  fontStyle: "italic",
                }}
              >
                “{v.evidence}”
              </blockquote>
            ) : (
              <p style={{ margin: 0, fontSize: "var(--body-3)", color: "var(--text-muted)" }}>
                No verbatim quote survived verification for this finding.
              </p>
            )}

            <footer>
              {v.reviewedAt ? (
                <span style={{ fontSize: "var(--body-3)", color: "var(--text-muted)" }}>
                  Reviewed {v.reviewedAt}
                  {v.reviewerName ? ` by ${v.reviewerName}` : ""}
                </span>
              ) : (
                <ReviewButton violationId={v.id} leadId={v.leadId} />
              )}
            </footer>
          </article>
        );
      })}
    </div>
  );
}
