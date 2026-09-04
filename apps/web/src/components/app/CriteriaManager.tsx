"use client";

import { CRITERION_TYPES, type CriterionType, type ScoringSettings } from "@solarwave/core";
import Link from "next/link";
import { useActionState, useState, useTransition, type CSSProperties } from "react";
import {
  deleteCriterionAction,
  initialActionState,
  saveCriterionAction,
  saveSettingsAction,
  toggleCriterionAction,
} from "@/app/portal/(shell)/criteria/actions";
import { DisplayHeading, PillButton } from "@/components/ds/soltera";
import { QUESTION_BUDGET, formatDateTimeYear, type Criterion } from "@/lib/leads";
import styles from "@/app/portal/portal.module.css";

const COLUMNS = "1.7fr 0.9fr 0.6fr 0.9fr 62px";
const MIN_WIDTH = 560;

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
  background: "var(--white)",
  borderRadius: "var(--radius-pill)",
  padding: "0 16px",
  fontSize: "var(--body-2)",
  color: "var(--text-strong)",
  outline: "none",
};

const errorStyle: CSSProperties = { fontSize: "var(--body-3)", color: "var(--ink-900)", marginTop: 4, paddingLeft: 4 };

const EXPECTED_HINT: Record<CriterionType, string> = {
  boolean: '"true" or "false"',
  numeric: '">= 300", "< 2000" or a range "300..1500"',
  enum: 'accepted values separated by "|", e.g. "ceramic|metal"',
  free_text: "no rule — passes when answered",
};

type FormState = {
  id: string | null;
  key: string;
  label: string;
  questionPt: string;
  questionEn: string;
  type: CriterionType;
  expectedValue: string;
  weight: string;
  blocking: boolean;
  active: boolean;
};

const EMPTY_FORM: FormState = {
  id: null,
  key: "",
  label: "",
  questionPt: "",
  questionEn: "",
  type: "boolean",
  expectedValue: "true",
  weight: "10",
  blocking: false,
  active: true,
};

type RecentAudit = {
  id: string;
  employee: string;
  when: Date;
  criterion: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
};

type Props = {
  criteria: Criterion[];
  settings: ScoringSettings;
  recentAudit: RecentAudit[];
  canEdit: boolean;
};

/**
 * Criteria-management spec. Reads come from the Server Component page; every
 * mutation is a Server Action that writes the row and its audit entries in one
 * transaction, then revalidates the portal.
 */
export function CriteriaManager({ criteria, settings, recentAudit, canEdit }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saveState, saveAction, saving] = useActionState(saveCriterionAction, initialActionState);
  const [settingsState, settingsAction, savingSettings] = useActionState(saveSettingsAction, initialActionState);
  const [rowMessage, setRowMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [handledNonce, setHandledNonce] = useState(0);

  // Reset the form once per successful save (state adjusted during render, no effect).
  if (saveState.ok && saveState.nonce !== handledNonce) {
    setHandledNonce(saveState.nonce);
    setForm(EMPTY_FORM);
  }

  const activeCount = criteria.filter((c) => c.active).length;
  const weightTotal = criteria.filter((c) => c.active).reduce((sum, c) => sum + c.weight, 0);
  const overBudget = activeCount > QUESTION_BUDGET;
  const editing = form.id !== null;

  const edit = (c: Criterion) =>
    setForm({
      id: c.id,
      key: c.key,
      label: c.label,
      questionPt: c.questionPt,
      questionEn: c.questionEn,
      type: c.type,
      expectedValue: c.expectedValue ?? "",
      weight: String(c.weight),
      blocking: c.blocking,
      active: c.active,
    });

  const toggle = (c: Criterion) => {
    if (!canEdit) return;
    startTransition(async () => {
      const r = await toggleCriterionAction(c.id, !c.active);
      setRowMessage(r.ok ? null : r.message);
    });
  };

  const remove = () => {
    if (!form.id || !canEdit) return;
    const id = form.id;
    startTransition(async () => {
      const r = await deleteCriterionAction(id);
      setRowMessage(r.ok ? null : r.message);
      if (r.ok) setForm(EMPTY_FORM);
    });
  };

  const fieldError = (name: string) => saveState.fieldErrors[name];

  return (
    <div className={styles.screen}>
      <div className={styles.screenHead}>
        <div>
          <DisplayHeading size="var(--display-3)">Qualification criteria</DisplayHeading>
          <p style={{ fontSize: "var(--body-2)", color: "var(--text-muted)", margin: "var(--space-2) 0 0" }}>
            {`What the AI agent asks about, and how much each answer moves the score. ${activeCount} active, weights total ${weightTotal}.`}
          </p>
          {overBudget ? (
            <p
              role="status"
              style={{
                fontSize: "var(--body-3)",
                color: "var(--text-strong)",
                margin: "var(--space-2) 0 0",
                borderLeft: "2px solid var(--ink-900)",
                paddingLeft: 10,
              }}
            >
              {`${activeCount} active criteria exceed the ${QUESTION_BUDGET}-question budget — the call may run past two minutes.`}
            </p>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: "var(--space-4)", alignItems: "center", flexWrap: "wrap" }}>
          <Link href="/portal/audit" className={styles.mono}>
            Audit history →
          </Link>
          {canEdit ? (
            <PillButton variant="primary" size="sm" icon="plus" onClick={() => setForm(EMPTY_FORM)}>
              New criterion
            </PillButton>
          ) : null}
        </div>
      </div>

      <div className={styles.criteriaGrid}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div className={styles.panel} style={{ opacity: isPending ? 0.6 : 1 }}>
            <div className={styles.tableScroll}>
              <div className={styles.thead} style={{ gridTemplateColumns: COLUMNS, gap: "var(--space-3)", minWidth: MIN_WIDTH }}>
                <span>Criterion</span>
                <span>Type</span>
                <span>Weight</span>
                <span>State</span>
                <span />
              </div>

              {criteria.map((c) => (
                <div
                  key={c.id}
                  className={styles.trow}
                  style={{
                    gridTemplateColumns: COLUMNS,
                    gap: "var(--space-3)",
                    minWidth: MIN_WIDTH,
                    padding: "14px 20px",
                    background: form.id === c.id ? "var(--ink-050)" : "var(--white)",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "var(--body-2)", fontWeight: 500, color: "var(--text-strong)" }}>
                      {c.label}
                      {c.blocking ? (
                        <span className={styles.mono} style={{ marginLeft: 8, letterSpacing: ".1em" }}>
                          blocking
                        </span>
                      ) : null}
                    </div>
                    <div className={styles.truncate} style={{ fontSize: "var(--body-3)", color: "var(--text-muted)", marginTop: 3 }}>
                      {c.questionEn}
                    </div>
                    <div className={styles.truncate} style={{ fontFamily: "var(--font-mono)", fontSize: "var(--label-2)", color: "var(--text-muted)", marginTop: 3 }}>
                      {c.key}
                      {c.expectedValue ? ` · ${c.expectedValue}` : ""}
                    </div>
                  </div>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--body-3)", color: "var(--text-body)" }}>{c.type}</span>
                  <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16, color: "var(--text-strong)" }}>{c.weight}</span>
                  <button
                    type="button"
                    onClick={() => toggle(c)}
                    aria-pressed={c.active}
                    disabled={!canEdit || isPending}
                    style={{
                      justifySelf: "start",
                      border: c.active ? "1px solid var(--ink-900)" : "1px dashed var(--ink-300)",
                      background: c.active ? "var(--ink-900)" : "var(--white)",
                      color: c.active ? "var(--white)" : "var(--text-muted)",
                      borderRadius: "var(--radius-pill)",
                      padding: "5px 11px",
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--label-2)",
                      letterSpacing: ".1em",
                      textTransform: "uppercase",
                      cursor: canEdit ? "pointer" : "default",
                      transition: "all var(--dur-base) var(--ease-out)",
                    }}
                  >
                    {c.active ? "active" : "inactive"}
                  </button>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => edit(c)}
                      style={{
                        justifySelf: "end",
                        border: "1px solid var(--line-hairline)",
                        background: "var(--white)",
                        borderRadius: "var(--radius-pill)",
                        padding: "5px 11px",
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--label-2)",
                        letterSpacing: ".1em",
                        textTransform: "uppercase",
                        color: "var(--text-body)",
                        cursor: "pointer",
                      }}
                    >
                      Edit
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
              ))}

              <div className={styles.tfoot}>
                <span>
                  {`${activeCount} active · ${criteria.length - activeCount} inactive · hand-off threshold ${settings.handoffThreshold} points`}
                </span>
                {rowMessage ? <span role="alert">{rowMessage}</span> : null}
              </div>
            </div>
          </div>

          {/* ---- Settings ---- */}
          <form action={settingsAction} style={{ background: "var(--surface-card)", borderRadius: "var(--radius-xl)", padding: 22 }}>
            <span
              style={{
                fontSize: "var(--title-1)",
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "var(--title-tracking)",
                color: "var(--text-strong)",
              }}
            >
              Scoring settings
            </span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
              <div>
                <label htmlFor="s-threshold" style={labelStyle}>
                  Hand-off threshold (points)
                </label>
                <input
                  id="s-threshold"
                  name="handoffThreshold"
                  inputMode="numeric"
                  defaultValue={settings.handoffThreshold}
                  disabled={!canEdit}
                  style={{ ...controlStyle, fontFamily: "var(--font-mono)" }}
                />
                {settingsState.fieldErrors.handoff_threshold ? (
                  <div style={errorStyle}>{settingsState.fieldErrors.handoff_threshold}</div>
                ) : null}
              </div>
              <div>
                <label htmlFor="s-share" style={labelStyle}>
                  Min. answered weight (%)
                </label>
                <input
                  id="s-share"
                  name="minAnsweredWeightShare"
                  inputMode="numeric"
                  defaultValue={Math.round(settings.minAnsweredWeightShare * 100)}
                  disabled={!canEdit}
                  style={{ ...controlStyle, fontFamily: "var(--font-mono)" }}
                />
                {settingsState.fieldErrors.min_answered_weight_share ? (
                  <div style={errorStyle}>{settingsState.fieldErrors.min_answered_weight_share}</div>
                ) : null}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginTop: "var(--space-4)", flexWrap: "wrap" }}>
              {canEdit ? (
                <PillButton type="submit" variant="ghost" size="sm" showKnob={false} disabled={savingSettings}>
                  {savingSettings ? "Saving…" : "Save settings"}
                </PillButton>
              ) : null}
              {settingsState.message ? (
                <span role="status" style={{ fontSize: "var(--body-3)", color: "var(--text-muted)" }}>
                  {settingsState.message}
                </span>
              ) : null}
            </div>
            <p style={{ fontSize: "var(--body-3)", lineHeight: 1.5, color: "var(--text-muted)", margin: "var(--space-3) 0 0", textWrap: "pretty" }}>
              A call counts as complete when every blocking criterion is answered and the answered criteria reach this share of the active weight.
            </p>
          </form>
        </div>

        <div style={{ background: "var(--surface-card)", borderRadius: "var(--radius-xl)", padding: 22 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
            <span
              style={{
                fontSize: "var(--title-1)",
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "var(--title-tracking)",
                color: "var(--text-strong)",
              }}
            >
              {canEdit ? (editing ? "Edit criterion" : "New criterion") : "Read only"}
            </span>
            {editing ? (
              <button
                type="button"
                onClick={() => setForm(EMPTY_FORM)}
                className={styles.mono}
                style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer" }}
              >
                Cancel
              </button>
            ) : null}
          </div>

          {canEdit ? (
            <form action={saveAction} noValidate style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", marginTop: "var(--space-5)" }}>
              <input type="hidden" name="id" value={form.id ?? ""} />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
                <div>
                  <label htmlFor="c-label" style={labelStyle}>
                    Label
                  </label>
                  <input
                    id="c-label"
                    name="label"
                    value={form.label}
                    onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                    placeholder="e.g. Roof usable area"
                    style={controlStyle}
                  />
                  {fieldError("label") ? <div style={errorStyle}>{fieldError("label")}</div> : null}
                </div>
                <div>
                  <label htmlFor="c-key" style={labelStyle}>
                    Key
                  </label>
                  <input
                    id="c-key"
                    name="key"
                    value={form.key}
                    onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
                    placeholder="roof_area"
                    style={{ ...controlStyle, fontFamily: "var(--font-mono)" }}
                  />
                  {fieldError("key") ? <div style={errorStyle}>{fieldError("key")}</div> : null}
                </div>
              </div>

              <div>
                <label htmlFor="c-question-pt" style={labelStyle}>
                  Question (Portuguese)
                </label>
                <input
                  id="c-question-pt"
                  name="questionPt"
                  value={form.questionPt}
                  onChange={(e) => setForm((f) => ({ ...f, questionPt: e.target.value }))}
                  placeholder="Você sabe mais ou menos qual é a área do telhado?"
                  style={controlStyle}
                />
                {fieldError("questionPt") ? <div style={errorStyle}>{fieldError("questionPt")}</div> : null}
              </div>

              <div>
                <label htmlFor="c-question-en" style={labelStyle}>
                  Question (English)
                </label>
                <input
                  id="c-question-en"
                  name="questionEn"
                  value={form.questionEn}
                  onChange={(e) => setForm((f) => ({ ...f, questionEn: e.target.value }))}
                  placeholder="How large is the usable roof area?"
                  style={controlStyle}
                />
                {fieldError("questionEn") ? <div style={errorStyle}>{fieldError("questionEn")}</div> : null}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 92px", gap: "var(--space-3)" }}>
                <div>
                  <label htmlFor="c-type" style={labelStyle}>
                    Type
                  </label>
                  <select
                    id="c-type"
                    name="type"
                    value={form.type}
                    onChange={(e) => {
                      const type = e.target.value as CriterionType;
                      setForm((f) => ({
                        ...f,
                        type,
                        expectedValue: type === "boolean" ? "true" : type === "free_text" ? "" : f.expectedValue,
                      }));
                    }}
                    style={{ ...controlStyle, padding: "0 14px" }}
                  >
                    {CRITERION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="c-weight" style={labelStyle}>
                    Weight
                  </label>
                  <input
                    id="c-weight"
                    name="weight"
                    inputMode="numeric"
                    value={form.weight}
                    onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))}
                    style={{ ...controlStyle, padding: "0 14px", fontFamily: "var(--font-mono)" }}
                  />
                  {fieldError("weight") ? <div style={errorStyle}>{fieldError("weight")}</div> : null}
                </div>
              </div>

              <div>
                <label htmlFor="c-expected" style={labelStyle}>
                  Expected value
                </label>
                <input
                  id="c-expected"
                  name="expectedValue"
                  value={form.expectedValue}
                  disabled={form.type === "free_text"}
                  onChange={(e) => setForm((f) => ({ ...f, expectedValue: e.target.value }))}
                  placeholder={EXPECTED_HINT[form.type]}
                  style={{ ...controlStyle, fontFamily: "var(--font-mono)" }}
                />
                <div style={{ fontSize: "var(--body-3)", color: "var(--text-muted)", marginTop: 4, paddingLeft: 4 }}>
                  {EXPECTED_HINT[form.type]}
                </div>
                {fieldError("expectedValue") ? <div style={errorStyle}>{fieldError("expectedValue")}</div> : null}
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--body-3)", color: "var(--text-body)" }}>
                <input
                  type="checkbox"
                  name="blocking"
                  checked={form.blocking}
                  onChange={() => setForm((f) => ({ ...f, blocking: !f.blocking }))}
                  style={{ width: 15, height: 15, accentColor: "var(--ink-900)" }}
                />
                Blocking — a failed answer disqualifies regardless of score
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--body-3)", color: "var(--text-body)" }}>
                <input
                  type="checkbox"
                  name="active"
                  checked={form.active}
                  onChange={() => setForm((f) => ({ ...f, active: !f.active }))}
                  style={{ width: 15, height: 15, accentColor: "var(--ink-900)" }}
                />
                Active — included in every new call
              </label>

              {saveState.message ? (
                <div
                  role={saveState.ok ? "status" : "alert"}
                  style={{
                    background: "var(--white)",
                    borderLeft: "2px solid var(--ink-900)",
                    fontSize: "var(--body-3)",
                    color: "var(--text-strong)",
                    padding: "10px 14px",
                    borderRadius: "var(--radius-xs)",
                  }}
                >
                  {saveState.message}
                </div>
              ) : null}

              <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
                <PillButton type="submit" variant="primary" size="sm" icon="check" disabled={saving}>
                  {saving ? "Saving…" : editing ? "Save changes" : "Create criterion"}
                </PillButton>
                {editing ? (
                  <PillButton variant="ghost" size="sm" showKnob={false} onClick={remove} disabled={isPending}>
                    Delete
                  </PillButton>
                ) : null}
              </div>

              <p style={{ fontSize: "var(--body-3)", lineHeight: 1.5, color: "var(--text-muted)", margin: 0, textWrap: "pretty" }}>
                Changes take effect on the next outbound call and are written to the audit log with your name.
              </p>
            </form>
          ) : (
            <p style={{ fontSize: "var(--body-3)", lineHeight: 1.5, color: "var(--text-muted)", margin: "var(--space-4) 0 0", textWrap: "pretty" }}>
              Only admins can create, edit or deactivate criteria. Ask an admin if a question needs to change.
            </p>
          )}

          <div style={{ marginTop: "var(--space-6)", borderTop: "1px solid rgba(11,11,11,.08)", paddingTop: "var(--space-4)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
              <span className={styles.mono}>Recent changes</span>
              <Link href="/portal/audit" className={styles.mono}>
                All →
              </Link>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", marginTop: "var(--space-3)" }}>
              {recentAudit.length === 0 ? (
                <span style={{ fontSize: "var(--body-3)", color: "var(--text-muted)" }}>No changes yet.</span>
              ) : (
                recentAudit.map((a) => (
                  <div key={a.id} style={{ display: "grid", gridTemplateColumns: "8px 1fr", gap: "var(--space-2)" }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--ink-400)", marginTop: 7 }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "var(--body-3)", lineHeight: 1.45, color: "var(--text-strong)", textWrap: "pretty" }}>
                        {`${a.employee} changed ${a.field} on “${a.criterion}” from ${a.oldValue ?? "—"} to ${a.newValue ?? "—"}`}
                      </div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--label-2)", letterSpacing: ".1em", color: "var(--text-muted)", marginTop: 3 }}>
                        {formatDateTimeYear(a.when)}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
