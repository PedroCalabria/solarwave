"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  retriggerScoringAction,
  type ScoringActionState,
} from "@/app/portal/(shell)/scoring-actions";

export type PendingItem = {
  attemptId: string;
  attemptNumber: number;
  leadId: string;
  leadName: string;
  endedAt: string | null;
};

const INITIAL: ScoringActionState = { ok: true, message: "", nonce: 0 };

function Retrigger({ item }: { item: PendingItem }) {
  const [state, action, pending] = useActionState(retriggerScoringAction, INITIAL);

  return (
    <form action={action} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
      <input type="hidden" name="attemptId" value={item.attemptId} />
      <input type="hidden" name="leadId" value={item.leadId} />
      <button
        type="submit"
        disabled={pending}
        style={{
          padding: "4px 10px",
          borderRadius: "var(--radius-2)",
          border: "1px solid var(--border-subtle)",
          background: "var(--surface-1)",
          color: "var(--text-body)",
          fontSize: "var(--body-3)",
          cursor: pending ? "wait" : "pointer",
        }}
      >
        {pending ? "Scoring…" : "Retry scoring"}
      </button>
      {state.message ? (
        <span style={{ fontSize: "var(--body-3)", color: state.ok ? "var(--text-muted)" : "#b91c1c" }}>
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

/**
 * Attempts whose scoring failed. The lead stays exactly where it was rather
 * than being given a fabricated decision (design D3), so the only way these
 * become visible is here.
 */
export function ScoringPendings({ pendings }: { pendings: PendingItem[] }) {
  if (pendings.length === 0) return null;

  return (
    <section
      style={{
        padding: "var(--space-4)",
        borderRadius: "var(--radius-3)",
        border: "1px solid rgba(220, 38, 38, 0.3)",
        background: "rgba(220, 38, 38, 0.05)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
      }}
    >
      <strong style={{ fontSize: "var(--body-2)", color: "#b91c1c" }}>
        {pendings.length === 1 ? "1 call could not be scored" : `${pendings.length} calls could not be scored`}
      </strong>
      <p style={{ margin: 0, fontSize: "var(--body-3)", color: "var(--text-muted)" }}>
        These leads keep the status they had. Nothing was guessed on their behalf.
      </p>

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {pendings.map((item) => (
          <li
            key={item.attemptId}
            style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}
          >
            <Link href={`/portal/leads/${item.leadId}`} style={{ fontSize: "var(--body-3)" }}>
              {item.leadName}
            </Link>
            <span style={{ fontSize: "var(--body-3)", color: "var(--text-muted)" }}>
              attempt {item.attemptNumber}
              {item.endedAt ? ` · ${item.endedAt}` : ""}
            </span>
            <Retrigger item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}
