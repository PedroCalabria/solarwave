"use client";

import { PERSONAS, PERSONA_KEYS } from "@solarwave/agent";
import { useActionState, useState, type CSSProperties } from "react";
import { simulateCallAction } from "@/app/portal/(shell)/simulate-actions";
import { PillButton } from "@/components/ds/soltera";
import styles from "@/app/portal/portal.module.css";

const initial = { ok: false, message: "", nonce: 0 };

const selectStyle: CSSProperties = {
  height: "var(--control-h-sm)",
  border: "1px solid var(--line-hairline)",
  background: "var(--white)",
  borderRadius: "var(--radius-pill)",
  padding: "0 14px",
  fontSize: "var(--body-3)",
  color: "var(--text-strong)",
  outline: "none",
};

/**
 * Runs a text conversation against this lead and scores it, with no telephony
 * involved (design D9).
 *
 * Admin-only, and the action refuses for an opted-out lead or one with a call
 * already in flight. The attempt it writes is real and moves the lead through
 * the same state machine a Twilio call will, which is what makes it worth
 * having — and why it is not offered to agents.
 */
export function SimulateCall({ leadId, disabled, note }: { leadId: string; disabled?: boolean; note?: string }) {
  const [state, action, pending] = useActionState(simulateCallAction, initial);
  const [persona, setPersona] = useState<string>("cooperative");

  return (
    <div style={{ background: "var(--surface-card)", borderRadius: "var(--radius-xl)", padding: 22 }}>
      <div className={styles.mono}>Simulated call</div>
      <p style={{ fontSize: "var(--body-3)", lineHeight: 1.55, color: "var(--text-muted)", margin: "var(--space-2) 0 var(--space-3)", textWrap: "pretty" }}>
        Runs the real conversation agent against a simulated lead, writes the attempt and scores it. No phone call is
        placed. The attempt is marked as simulated wherever it appears.
      </p>

      <form action={action} style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
        <input type="hidden" name="leadId" value={leadId} />
        <select
          name="persona"
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          disabled={pending || disabled}
          aria-label="Lead persona"
          style={selectStyle}
        >
          {PERSONA_KEYS.map((key) => (
            <option key={key} value={key}>
              {PERSONAS[key].label}
            </option>
          ))}
        </select>
        <PillButton type="submit" variant="primary" size="sm" icon="check" disabled={pending || disabled}>
          {pending ? "Calling…" : "Simulate call"}
        </PillButton>
      </form>

      {disabled && note ? (
        <p style={{ fontSize: "var(--body-3)", color: "var(--text-muted)", margin: "var(--space-3) 0 0" }}>{note}</p>
      ) : null}

      {state.message ? (
        <div
          role={state.ok ? "status" : "alert"}
          style={{
            background: "var(--white)",
            borderLeft: "2px solid var(--ink-900)",
            fontSize: "var(--body-3)",
            color: "var(--text-strong)",
            padding: "10px 14px",
            borderRadius: "var(--radius-xs)",
            marginTop: "var(--space-3)",
          }}
        >
          {state.message}
        </div>
      ) : null}
    </div>
  );
}
