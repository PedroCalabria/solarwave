import Link from "next/link";
import { DisplayHeading, PillButton } from "@/components/ds/soltera";
import { AUDIT } from "@/lib/leads";
import styles from "../../portal.module.css";

export const metadata = { title: "Audit history · SolarWave console" };

const COLUMNS = "1.05fr 1.3fr 0.9fr 1fr 1fr";
const MIN_WIDTH = 900;

/** Spec §5.4 — every criteria change, who made it, and the before/after value. */
export default function AuditPage() {
  return (
    <div className={styles.screen}>
      <Link href="/portal/criteria" className={styles.mono} style={{ display: "inline-block" }}>
        ← Qualification criteria
      </Link>

      <div className={styles.screenHead} style={{ marginTop: "var(--space-4)" }}>
        <div>
          <DisplayHeading size="var(--display-3)">Audit history</DisplayHeading>
          <p style={{ fontSize: "var(--body-2)", color: "var(--text-muted)", margin: "var(--space-2) 0 0" }}>
            Every change to the qualification criteria, newest first. Retained 24 months.
          </p>
        </div>
        <PillButton variant="ghost" size="sm" icon="download">
          Export CSV
        </PillButton>
      </div>

      <div className={styles.panel} style={{ marginTop: "var(--space-6)" }}>
        <div className={styles.tableScroll}>
          <div className={styles.thead} style={{ gridTemplateColumns: COLUMNS, minWidth: MIN_WIDTH }}>
            <span>Employee</span>
            <span>Criterion</span>
            <span>Field</span>
            <span>Old value</span>
            <span>New value</span>
          </div>

          {AUDIT.map((entry) => (
            <div
              key={entry.id}
              className={styles.trow}
              style={{ gridTemplateColumns: COLUMNS, minWidth: MIN_WIDTH, padding: "14px 20px" }}
            >
              <div>
                <div style={{ fontSize: "var(--body-2)", fontWeight: 500, color: "var(--text-strong)" }}>
                  {entry.employee}
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--label-2)", letterSpacing: ".08em", color: "var(--text-muted)", marginTop: 3 }}>
                  {entry.when}
                </div>
              </div>
              <div style={{ fontSize: "var(--body-3)", color: "var(--text-strong)" }}>{entry.criterion}</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--body-3)", color: "var(--text-body)" }}>
                {entry.field}
              </div>
              <div
                style={{
                  justifySelf: "start",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--label-1)",
                  color: "var(--text-muted)",
                  background: "var(--ink-100)",
                  borderRadius: "var(--radius-xs)",
                  padding: "4px 9px",
                }}
              >
                {entry.oldValue}
              </div>
              <div
                style={{
                  justifySelf: "start",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--label-1)",
                  color: "var(--white)",
                  background: "var(--ink-900)",
                  borderRadius: "var(--radius-xs)",
                  padding: "4px 9px",
                }}
              >
                {entry.newValue}
              </div>
            </div>
          ))}

          <div className={styles.tfoot}>
            <span>{`${AUDIT.length} entries · retained 24 months · exportable for compliance review`}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
