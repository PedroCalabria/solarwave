"use client";

import type { BudgetConsumption, OperationsSettings } from "@solarwave/core";
import { useActionState, type CSSProperties } from "react";
import { saveOperationsAction } from "@/app/portal/(shell)/operations/actions";
import { initialOperationsState } from "@/app/portal/(shell)/operations/state";
import { DisplayHeading, PillButton } from "@/components/ds/soltera";
import styles from "@/app/portal/portal.module.css";

/**
 * The operational envelope, as an employee sees it (`lead-portal` spec).
 *
 * The point of the page is that a budget is visible BEFORE a call is refused.
 * Discovering an exhausted allowance from a failed dispatch tells an operator
 * the wrong thing at the wrong moment.
 */

type Props = {
  settings: OperationsSettings;
  consumption: BudgetConsumption;
  canEdit: boolean;
};

const labelStyle: CSSProperties = {
  display: "block",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--label-2)",
  fontWeight: 500,
  letterSpacing: "var(--label-tracking)",
  textTransform: "uppercase",
  color: "var(--text-strong)",
  marginBottom: 6,
};

const controlStyle: CSSProperties = {
  width: "100%",
  height: "var(--control-h-sm)",
  border: "1px solid var(--line-hairline)",
  borderRadius: "var(--radius-sm)",
  background: "var(--surface-1)",
  color: "var(--text-strong)",
  padding: "0 var(--space-3)",
  fontFamily: "var(--font-mono)",
};

const errorStyle: CSSProperties = { marginTop: 6, fontSize: "var(--body-3)", color: "var(--danger, #b3261e)" };

const mutedStyle: CSSProperties = { fontSize: "var(--body-3)", lineHeight: 1.5, color: "var(--text-muted)" };

function Meter({ label, used, limit, unit }: { label: string; used: number; limit: number; unit: string }) {
  const exhausted = limit === 0 || used >= limit;
  const pct = limit === 0 ? 100 : Math.min(100, Math.round((100 * used) / limit));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", marginBottom: 6 }}>
        <span style={labelStyle}>{label}</span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--body-3)",
            color: exhausted ? "var(--danger, #b3261e)" : "var(--text-muted)",
          }}
        >
          {used} / {limit} {unit}
          {exhausted ? " · exhausted" : ""}
        </span>
      </div>
      <div
        aria-hidden
        style={{ height: 6, borderRadius: 3, background: "var(--surface-2, #eee)", overflow: "hidden" }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: exhausted ? "var(--danger, #b3261e)" : "var(--text-strong)",
          }}
        />
      </div>
    </div>
  );
}

export function OperationsPanel({ settings, consumption, canEdit }: Props) {
  const [state, action, saving] = useActionState(saveOperationsAction, initialOperationsState);
  const monthlyMinutes = Math.round(settings.monthlyVoiceSecondsBudget / 60);
  const usedMinutes = Math.round(consumption.voiceSecondsThisMonth / 60);

  return (
    <div className={styles.screen}>
      <div className={styles.screenHead}>
        <div>
          <DisplayHeading size="var(--display-3)">Operations</DisplayHeading>
          <p
            style={{
              fontSize: "var(--body-2)",
              color: "var(--text-muted)",
              margin: "var(--space-2) 0 0",
              maxWidth: "62ch",
              textWrap: "pretty",
            }}
          >
            Whether the scheduler may place calls on its own, and how much it and everyone else may spend. Budgets are
            counted in the two things that actually run out: calls placed, and telephony minutes consumed. Simulated
            calls count against neither.
          </p>
        </div>
      </div>

      <div
        className={styles.panel}
        style={{ display: "grid", gap: "var(--space-5)", padding: "var(--space-6)", maxWidth: 880 }}
      >
        <div style={{ display: "grid", gap: "var(--space-4)" }}>
          <Meter label="Calls today" used={consumption.callsToday} limit={settings.dailyCallBudget} unit="calls" />
          <Meter label="Voice this month" used={usedMinutes} limit={monthlyMinutes} unit="min" />
        </div>

        <form action={action} style={{ display: "grid", gap: "var(--space-4)" }}>
          <label
            htmlFor="autoDispatchEnabled"
            style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)", cursor: canEdit ? "pointer" : "default" }}
          >
            <input
              id="autoDispatchEnabled"
              name="autoDispatchEnabled"
              type="checkbox"
              defaultChecked={settings.autoDispatchEnabled}
              disabled={!canEdit}
              style={{ marginTop: 3 }}
            />
            <span>
              <span style={{ ...labelStyle, marginBottom: 2 }}>Automatic dispatch</span>
              <span style={mutedStyle}>
                Lets the scheduler place calls without anyone present. Off by default. It does not affect the manual
                &ldquo;Call now&rdquo; action, which is a person&rsquo;s decision — but both obey the budgets above.
              </span>
            </span>
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
            <div>
              <label htmlFor="dailyCallBudget" style={labelStyle}>
                Daily call budget
              </label>
              <input
                id="dailyCallBudget"
                name="dailyCallBudget"
                inputMode="numeric"
                defaultValue={settings.dailyCallBudget}
                disabled={!canEdit}
                style={controlStyle}
              />
              {state.fieldErrors.daily_call_budget ? <div style={errorStyle}>{state.fieldErrors.daily_call_budget}</div> : null}
            </div>
            <div>
              <label htmlFor="monthlyVoiceMinutes" style={labelStyle}>
                Monthly voice budget (min)
              </label>
              <input
                id="monthlyVoiceMinutes"
                name="monthlyVoiceMinutes"
                inputMode="numeric"
                defaultValue={monthlyMinutes}
                disabled={!canEdit}
                style={controlStyle}
              />
              {state.fieldErrors.monthly_voice_seconds_budget ? (
                <div style={errorStyle}>{state.fieldErrors.monthly_voice_seconds_budget}</div>
              ) : null}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
            {canEdit ? (
              <PillButton type="submit" variant="ghost" size="sm" showKnob={false} disabled={saving}>
                {saving ? "Saving…" : "Save operations"}
              </PillButton>
            ) : null}
            {state.message ? (
              <span role="status" style={{ fontSize: "var(--body-3)", color: "var(--text-muted)" }}>
                {state.message}
              </span>
            ) : null}
          </div>

            <p style={{ ...mutedStyle, margin: 0, textWrap: "pretty" }}>
              Every change here is audited with your name, the previous value and the new one. That is deliberate: turning
              automatic dispatch on is what lets the system spend a metered allowance with nobody watching.
            </p>
          </form>
      </div>
    </div>
  );
}
