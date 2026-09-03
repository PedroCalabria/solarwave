"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { DisplayHeading, PillButton } from "@/components/ds/soltera";
import {
  AUDIT,
  CRITERIA,
  type AuditEntry,
  type Criterion,
  type CriterionType,
} from "@/lib/leads";
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

type FormState = {
  id: string | null;
  name: string;
  question: string;
  type: CriterionType;
  weight: string;
  active: boolean;
};

const EMPTY_FORM: FormState = {
  id: null,
  name: "",
  question: "",
  type: "boolean",
  weight: "10",
  active: true,
};

const TYPES: CriterionType[] = ["boolean", "numeric", "enum", "free_text"];

/**
 * Spec §5.3–5.4. Edits live in component state; wiring this to `packages/db`
 * must write the criterion and its audit row in one transaction so the log can
 * never drift from the criteria it describes.
 */
export function CriteriaManager() {
  const [criteria, setCriteria] = useState<Criterion[]>(CRITERIA);
  const [audit, setAudit] = useState<AuditEntry[]>(AUDIT);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  const activeCount = criteria.filter((c) => c.active).length;
  const weightTotal = criteria.filter((c) => c.active).reduce((sum, c) => sum + c.weight, 0);
  const editing = form.id !== null;

  const logChange = (
    criterion: string,
    field: string,
    oldValue: string | number | boolean,
    newValue: string | number | boolean,
  ) => {
    setAudit((prev) => [
      {
        id: `a${Date.now()}`,
        employee: "Lucas Prado",
        when: "Just now",
        criterion,
        field,
        oldValue: String(oldValue),
        newValue: String(newValue),
      },
      ...prev,
    ]);
  };

  const save = () => {
    if (!form.name.trim()) {
      setFormError("Give the criterion a name.");
      return;
    }
    const weight = Number.parseInt(form.weight, 10);
    if (Number.isNaN(weight) || weight < 0 || weight > 100) {
      setFormError("Weight must be a number between 0 and 100.");
      return;
    }

    if (form.id) {
      const previous = criteria.find((c) => c.id === form.id);
      setCriteria((prev) =>
        prev.map((c) =>
          c.id === form.id
            ? { ...c, name: form.name, question: form.question, type: form.type, weight, active: form.active }
            : c,
        ),
      );
      if (previous && previous.weight !== weight) logChange(form.name, "weight", previous.weight, weight);
      else logChange(form.name, "definition", "edited", "saved");
    } else {
      setCriteria((prev) => [
        ...prev,
        {
          id: `c${Date.now()}`,
          name: form.name,
          question: form.question,
          type: form.type,
          weight,
          active: form.active,
        },
      ]);
      logChange(form.name, "created", "—", `${form.type}, weight ${weight}`);
    }

    setForm(EMPTY_FORM);
    setFormError(null);
  };

  const remove = () => {
    if (!form.id) return;
    setCriteria((prev) => prev.filter((c) => c.id !== form.id));
    logChange(form.name, "deleted", "active", "removed");
    setForm(EMPTY_FORM);
    setFormError(null);
  };

  const toggle = (criterion: Criterion) => {
    setCriteria((prev) =>
      prev.map((c) => (c.id === criterion.id ? { ...c, active: !c.active } : c)),
    );
    logChange(criterion.name, "active", criterion.active, !criterion.active);
  };

  return (
    <div className={styles.screen}>
      <div className={styles.screenHead}>
        <div>
          <DisplayHeading size="var(--display-3)">Qualification criteria</DisplayHeading>
          <p style={{ fontSize: "var(--body-2)", color: "var(--text-muted)", margin: "var(--space-2) 0 0" }}>
            {`What the AI agent asks about, and how much each answer moves the score. Active weights total ${weightTotal}.`}
          </p>
        </div>
        <div style={{ display: "flex", gap: "var(--space-4)", alignItems: "center", flexWrap: "wrap" }}>
          <Link href="/portal/audit" className={styles.mono}>
            Audit history →
          </Link>
          <PillButton
            variant="primary"
            size="sm"
            icon="plus"
            onClick={() => {
              setForm(EMPTY_FORM);
              setFormError(null);
            }}
          >
            New criterion
          </PillButton>
        </div>
      </div>

      <div className={styles.criteriaGrid}>
        <div className={styles.panel}>
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
                    {c.name}
                  </div>
                  <div className={styles.truncate} style={{ fontSize: "var(--body-3)", color: "var(--text-muted)", marginTop: 3 }}>
                    {c.question}
                  </div>
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--body-3)", color: "var(--text-body)" }}>
                  {c.type}
                </span>
                <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16, color: "var(--text-strong)" }}>
                  {c.weight}
                </span>
                <button
                  type="button"
                  onClick={() => toggle(c)}
                  aria-pressed={c.active}
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
                    transition: "all var(--dur-base) var(--ease-out)",
                  }}
                >
                  {c.active ? "active" : "inactive"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setForm({
                      id: c.id,
                      name: c.name,
                      question: c.question,
                      type: c.type,
                      weight: String(c.weight),
                      active: c.active,
                    })
                  }
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
                  }}
                >
                  Edit
                </button>
              </div>
            ))}

            <div className={styles.tfoot}>
              <span>
                {`${activeCount} active · ${criteria.length - activeCount} inactive · hand-off threshold 70 points`}
              </span>
            </div>
          </div>
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
              {editing ? "Edit criterion" : "New criterion"}
            </span>
            {editing ? (
              <button
                type="button"
                onClick={() => {
                  setForm(EMPTY_FORM);
                  setFormError(null);
                }}
                className={styles.mono}
                style={{ border: 0, background: "transparent", padding: 0 }}
              >
                Cancel
              </button>
            ) : null}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
            noValidate
            style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", marginTop: "var(--space-5)" }}
          >
            <div>
              <label htmlFor="c-name" style={labelStyle}>
                Name
              </label>
              <input
                id="c-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Roof usable area"
                style={controlStyle}
              />
            </div>

            <div>
              <label htmlFor="c-question" style={labelStyle}>
                Question the agent asks
              </label>
              <input
                id="c-question"
                value={form.question}
                onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))}
                placeholder="How large is the usable roof area?"
                style={controlStyle}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 92px", gap: "var(--space-3)" }}>
              <div>
                <label htmlFor="c-type" style={labelStyle}>
                  Type
                </label>
                <select
                  id="c-type"
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as CriterionType }))}
                  style={{ ...controlStyle, padding: "0 14px" }}
                >
                  {TYPES.map((t) => (
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
                  inputMode="numeric"
                  value={form.weight}
                  onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))}
                  style={{ ...controlStyle, padding: "0 14px", fontFamily: "var(--font-mono)" }}
                />
              </div>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--body-3)", color: "var(--text-body)" }}>
              <input
                type="checkbox"
                checked={form.active}
                onChange={() => setForm((f) => ({ ...f, active: !f.active }))}
                style={{ width: 15, height: 15, accentColor: "var(--ink-900)" }}
              />
              Active — included in every new call
            </label>

            {formError ? (
              <div
                role="alert"
                style={{
                  background: "var(--white)",
                  borderLeft: "2px solid var(--ink-900)",
                  fontSize: "var(--body-3)",
                  color: "var(--text-strong)",
                  padding: "10px 14px",
                  borderRadius: "var(--radius-xs)",
                }}
              >
                {formError}
              </div>
            ) : null}

            <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
              <PillButton type="submit" variant="primary" size="sm" icon="check">
                {editing ? "Save changes" : "Create criterion"}
              </PillButton>
              {editing ? (
                <PillButton variant="ghost" size="sm" showKnob={false} onClick={remove}>
                  Delete
                </PillButton>
              ) : null}
            </div>

            <p style={{ fontSize: "var(--body-3)", lineHeight: 1.5, color: "var(--text-muted)", margin: 0, textWrap: "pretty" }}>
              Changes take effect on the next outbound call and are written to the audit log with
              your name.
            </p>
          </form>

          <div style={{ marginTop: "var(--space-6)", borderTop: "1px solid rgba(11,11,11,.08)", paddingTop: "var(--space-4)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
              <span className={styles.mono}>Recent changes</span>
              <Link href="/portal/audit" className={styles.mono}>
                All →
              </Link>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", marginTop: "var(--space-3)" }}>
              {audit.slice(0, 3).map((a) => (
                <div key={a.id} style={{ display: "grid", gridTemplateColumns: "8px 1fr", gap: "var(--space-2)" }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--ink-400)", marginTop: 7 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "var(--body-3)", lineHeight: 1.45, color: "var(--text-strong)", textWrap: "pretty" }}>
                      {`${a.employee} changed ${a.field} on “${a.criterion}” from ${a.oldValue} to ${a.newValue}`}
                    </div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--label-2)", letterSpacing: ".1em", color: "var(--text-muted)", marginTop: 3 }}>
                      {a.when}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
