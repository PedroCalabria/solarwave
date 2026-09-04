import { getDb, listAudit } from "@solarwave/db";
import Link from "next/link";
import { DisplayHeading } from "@/components/ds/soltera";
import { formatDateTimeYear } from "@/lib/leads";
import styles from "../../portal.module.css";

export const metadata = { title: "Audit history · SolarWave console" };
export const dynamic = "force-dynamic";

const COLUMNS = "1.05fr 1.3fr 0.9fr 1fr 1fr";
const MIN_WIDTH = 900;

/** Spec section 5.4: every criteria and settings change, who made it, and the before/after value. */
export default async function AuditPage() {
  const entries = await listAudit(getDb(), 500);

  return (
    <div className={styles.screen}>
      <Link href="/portal/criteria" className={styles.mono} style={{ display: "inline-block" }}>
        ← Qualification criteria
      </Link>

      <div className={styles.screenHead} style={{ marginTop: "var(--space-4)" }}>
        <div>
          <DisplayHeading size="var(--display-3)">Audit history</DisplayHeading>
          <p style={{ fontSize: "var(--body-2)", color: "var(--text-muted)", margin: "var(--space-2) 0 0" }}>
            Every change to the qualification criteria and scoring settings, newest first.
          </p>
        </div>
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

          {entries.length === 0 ? (
            <div style={{ padding: "40px 20px", fontSize: "var(--body-3)", color: "var(--text-muted)", textAlign: "center" }}>
              No changes recorded yet.
            </div>
          ) : null}

          {entries.map((entry) => {
            const isSetting = entry.field.startsWith("setting:");
            return (
              <div
                key={entry.id}
                className={styles.trow}
                style={{ gridTemplateColumns: COLUMNS, minWidth: MIN_WIDTH, padding: "14px 20px" }}
              >
                <div>
                  <div style={{ fontSize: "var(--body-2)", fontWeight: 500, color: "var(--text-strong)" }}>
                    {entry.employeeName ?? "Unknown"}
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--label-2)", letterSpacing: ".08em", color: "var(--text-muted)", marginTop: 3 }}>
                    {formatDateTimeYear(entry.changedAt)}
                  </div>
                </div>
                <div style={{ fontSize: "var(--body-3)", color: "var(--text-strong)" }}>
                  {isSetting ? "Scoring settings" : (entry.criterionLabel ?? entry.criterionKey ?? "—")}
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--body-3)", color: "var(--text-body)" }}>
                  {isSetting ? entry.field.slice("setting:".length) : entry.field}
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
                    maxWidth: "100%",
                    overflowWrap: "anywhere",
                  }}
                >
                  {entry.oldValue ?? "—"}
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
                    maxWidth: "100%",
                    overflowWrap: "anywhere",
                  }}
                >
                  {entry.newValue ?? "—"}
                </div>
              </div>
            );
          })}

          <div className={styles.tfoot}>
            <span>{`${entries.length} entries · retained with the criteria they describe`}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
