"use client";

import { useActionState } from "react";
import { callNowAction } from "@/app/portal/(shell)/call-actions";
import { PillButton } from "@/components/ds/soltera";
import styles from "@/app/portal/portal.module.css";

const initial = { ok: false, message: "", nonce: 0 };

/**
 * Places a real telephone call to this lead.
 *
 * Deliberately not confusable with the simulated call above it: this one says
 * it dials a real number and spends telephony minutes, and it is the only
 * action on this page that reaches outside the system.
 */
export function CallNow({ leadId, disabled, note }: { leadId: string; disabled?: boolean; note?: string }) {
  const [state, action, pending] = useActionState(callNowAction, initial);

  return (
    <div
      style={{
        background: "var(--surface-card)",
        borderRadius: "var(--radius-xl)",
        padding: 22,
        border: "1px solid var(--line-hairline)",
      }}
    >
      <div className={styles.mono}>Real call</div>
      <p
        style={{
          fontSize: "var(--body-3)",
          lineHeight: 1.55,
          color: "var(--text-muted)",
          margin: "var(--space-2) 0 var(--space-3)",
          textWrap: "pretty",
        }}
      >
        Dials this lead&rsquo;s telephone number and runs the voice agent on the line. It spends telephony minutes and
        the person actually answers, so use it deliberately.
      </p>

      <form action={action}>
        <input type="hidden" name="leadId" value={leadId} />
        <PillButton type="submit" disabled={disabled || pending}>
          {pending ? "Dialling…" : "Call now"}
        </PillButton>
      </form>

      {note ? (
        <p style={{ fontSize: "var(--body-3)", color: "var(--text-muted)", marginTop: "var(--space-3)" }}>{note}</p>
      ) : null}
      {state.message ? (
        <p
          key={state.nonce}
          style={{
            fontSize: "var(--body-3)",
            color: state.ok ? "var(--text-strong)" : "var(--danger, #b3261e)",
            marginTop: "var(--space-3)",
          }}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
