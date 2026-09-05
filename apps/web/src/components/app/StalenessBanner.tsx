"use client";

import { useActionState } from "react";
import {
  reprocessAction,
  rescoreAction,
  type ScoringActionState,
} from "@/app/portal/(shell)/scoring-actions";

export type StalenessProps = {
  staleness: { state: "never_scored" } | { state: "fresh" } | { state: "stale"; required: string; available: string };
  attemptId: string;
  leadId: string;
};

const INITIAL: ScoringActionState = { ok: true, message: "", nonce: 0 };

const shell = {
  padding: "var(--space-4)",
  borderRadius: "var(--radius-3)",
  border: "1px solid rgba(217, 119, 6, 0.35)",
  background: "rgba(217, 119, 6, 0.07)",
  display: "flex",
  flexDirection: "column" as const,
  gap: "var(--space-2)",
};

const button = {
  padding: "8px 14px",
  borderRadius: "var(--radius-2)",
  border: "1px solid var(--border-subtle)",
  background: "var(--surface-1)",
  color: "var(--text-strong)",
  fontSize: "var(--body-3)",
  cursor: "pointer",
};

export function StalenessBanner({ staleness, attemptId, leadId }: StalenessProps) {
  const isRescore = staleness.state === "stale" && staleness.available === "rescore";
  const [state, action, pending] = useActionState(isRescore ? rescoreAction : reprocessAction, INITIAL);

  if (staleness.state !== "stale") return null;

  // The label has to say what the action costs before it is pressed: one path
  // is free and instant, the other spends a model call (design D9).
  const copy =
    staleness.available === "rescore"
      ? {
          title: "Criteria changed since this lead was scored",
          body: "The stored answers still cover every criterion, so refreshing the score is instant and free — no AI is used.",
          label: "Re-score now",
        }
      : staleness.available === "reprocess"
        ? {
            title: "Criteria changed in a way the stored answers cannot cover",
            body: "Refreshing this score means reading the transcript again with AI, because a criterion is new, was reactivated, changed type, or its vocabulary moved.",
            label: "Reprocess transcript with AI",
          }
        : {
            title: "Score frozen: criteria changed since scoring",
            body: "Refreshing would need the transcript, and it was purged under the twelve-month retention policy. The score below is the last one computed.",
            label: null,
          };

  return (
    <div style={shell}>
      <strong style={{ fontSize: "var(--body-2)", color: "#b45309" }}>{copy.title}</strong>
      <p style={{ margin: 0, fontSize: "var(--body-3)", color: "var(--text-body)" }}>{copy.body}</p>

      {copy.label ? (
        <form action={action} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <input type="hidden" name="attemptId" value={attemptId} />
          <input type="hidden" name="leadId" value={leadId} />
          <button type="submit" disabled={pending} style={{ ...button, cursor: pending ? "wait" : "pointer" }}>
            {pending ? "Working…" : copy.label}
          </button>
          {state.message ? (
            <span style={{ fontSize: "var(--body-3)", color: state.ok ? "var(--text-muted)" : "#b91c1c" }}>
              {state.message}
            </span>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
