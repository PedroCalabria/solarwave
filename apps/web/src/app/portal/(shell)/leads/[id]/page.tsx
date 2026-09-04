import { getDb, getLeadDetail, getSettings } from "@solarwave/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DisplayHeading } from "@/components/ds/soltera";
import {
  MAX_ATTEMPTS,
  STATUS,
  formatDateTime,
  formatDuration,
  formatPhone,
  languageLabel,
  outcomeLabel,
  scoreColor,
} from "@/lib/leads";
import styles from "../../../portal.module.css";
import detail from "./detail.module.css";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function scoreNote(status: string, score: number | null, threshold: number, failedBlocking: boolean): string {
  if (status === "calling") return "Score is computed when the call ends.";
  if (status === "new") return "Score is computed when the first call ends.";
  if (status === "opt_out") return "No score. Contact is blocked for all future outreach.";
  if (score === null) return "No criteria answered by phone.";
  if (failedBlocking) return "Disqualified on a blocking criterion, regardless of weight total.";
  if (status === "waiting_retry") return "Partial score from an incomplete call.";
  return score >= threshold ? `At or above the ${threshold}-point hand-off threshold.` : `Below the ${threshold}-point hand-off threshold.`;
}

function transcriptNote(status: string): string {
  switch (status) {
    case "new":
      return "The first call is queued. Transcript appears here once the agent has spoken to the lead.";
    case "calling":
      return "The transcript appears here shortly after the call ends.";
    case "no_answer_final":
      return "This lead never answered. No conversation was recorded.";
    default:
      return "No conversation with a transcript yet.";
  }
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const db = getDb();
  const [lead, settings] = await Promise.all([getLeadDetail(db, id), getSettings(db)]);
  if (!lead) notFound();

  const badge = STATUS[lead.status];
  const colour = scoreColor(lead.score, settings.handoffThreshold);
  const answers = [...(lead.latestScoredAttempt?.answers ?? [])].sort(
    (a, b) => a.criterion.sortOrder - b.criterion.sortOrder,
  );
  const failedBlocking = answers.some((a) => a.criterion.blocking && a.passed === false);
  const transcriptAttempt = lead.latestTranscriptAttempt;

  const fields = [
    { label: "Phone", value: formatPhone(lead.phone) },
    { label: "Email", value: lead.email },
    { label: "Call language", value: languageLabel(lead.preferredCallLanguage) },
    { label: "Timezone", value: `${lead.timezone} (DDD ${lead.ddd})` },
    { label: "Source", value: lead.source ?? "—" },
    { label: "Created", value: formatDateTime(lead.createdAt) },
    { label: "Next call", value: lead.nextCallAt ? formatDateTime(lead.nextCallAt) : "—" },
    { label: "Opt-out", value: lead.optOutAt ? formatDateTime(lead.optOutAt) : "—" },
  ];

  return (
    <div className={styles.screen} style={{ paddingTop: "var(--space-6)" }}>
      <Link href="/portal/leads" className={styles.mono} style={{ display: "inline-block" }}>
        ← All leads
      </Link>

      <div className={styles.screenHead} style={{ marginTop: "var(--space-4)" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", flexWrap: "wrap" }}>
            <DisplayHeading size="var(--display-3)">{lead.name}</DisplayHeading>
            <span
              className={styles.badge}
              style={{ background: badge.bg, color: badge.fg, border: badge.border, fontSize: "var(--label-1)", padding: "6px 12px" }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: badge.fg, animation: badge.dot }} />
              {badge.label}
            </span>
          </div>
          <div style={{ fontSize: "var(--body-3)", color: "var(--text-muted)", marginTop: "var(--space-2)" }}>
            {`${lead.source ?? "landing page"} · created ${formatDateTime(lead.createdAt)} · call language ${languageLabel(
              lead.preferredCallLanguage,
            )}`}
          </div>
        </div>
      </div>

      <div className={detail.grid}>
        <div className={detail.column}>
          {/* ---- Score, reason, icebreaker ---- */}
          <div style={{ background: "var(--surface-card)", borderRadius: "var(--radius-xl)", padding: 22 }}>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "var(--space-4)" }}>
              <div>
                <div className={styles.mono}>Qualification score</div>
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 600,
                    fontSize: "var(--display-1)",
                    letterSpacing: "-.035em",
                    lineHeight: 1,
                    marginTop: "var(--space-2)",
                    color: colour,
                  }}
                >
                  {lead.score === null ? "—" : lead.score}
                </div>
              </div>
              <div style={{ fontSize: "var(--body-3)", color: "var(--text-muted)", textAlign: "right", maxWidth: 180, textWrap: "pretty" }}>
                {scoreNote(lead.status, lead.score, settings.handoffThreshold, failedBlocking)}
              </div>
            </div>

            <div style={{ height: 3, background: "var(--line-track)", marginTop: "var(--space-5)", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${lead.score ?? 0}%`,
                  background: "var(--ink-900)",
                  transformOrigin: "left",
                  animation: "solGrow 700ms var(--ease-out) both",
                }}
              />
            </div>

            <div style={{ marginTop: "var(--space-5)", borderTop: "1px solid rgba(11,11,11,.08)", paddingTop: "var(--space-4)" }}>
              <div className={styles.mono}>Reason</div>
              <p style={{ fontSize: "var(--body-2)", lineHeight: 1.55, color: "var(--text-strong)", margin: "var(--space-2) 0 0", textWrap: "pretty" }}>
                {lead.qualificationReason ?? "—"}
              </p>
            </div>

            <div style={{ marginTop: "var(--space-4)", background: "var(--surface-invert)", borderRadius: "var(--radius-md)", padding: 16 }}>
              <div className={styles.mono} style={{ color: "rgba(255,255,255,.6)" }}>
                Icebreaker
              </div>
              <p style={{ fontSize: "var(--body-2)", lineHeight: 1.55, color: "var(--text-onDark)", margin: "var(--space-2) 0 0", textWrap: "pretty" }}>
                {lead.icebreaker ?? "—"}
              </p>
            </div>
          </div>

          {/* ---- Qualification answers (criteria-driven) ---- */}
          <div className={styles.panel}>
            <div className={detail.panelHead} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
              <span>Qualification answers</span>
              <span className={styles.mono} style={{ letterSpacing: ".1em" }}>
                {lead.latestScoredAttempt ? `attempt ${lead.latestScoredAttempt.attemptNumber}` : "no answers yet"}
              </span>
            </div>
            <dl style={{ margin: 0 }}>
              {answers.length === 0 ? (
                <div style={{ padding: "18px 20px", fontSize: "var(--body-3)", color: "var(--text-muted)" }}>
                  No criteria answered yet.
                </div>
              ) : (
                answers.map((a) => (
                  <div key={a.id} className={detail.fieldRow}>
                    <dt className={styles.mono} style={{ letterSpacing: ".1em", margin: 0 }}>
                      {a.criterion.label}
                      {a.criterion.blocking ? " · blocking" : ""}
                    </dt>
                    <dd style={{ fontSize: "var(--body-3)", color: "var(--text-strong)", textAlign: "right", margin: 0, display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                      <span>{a.extractedValue ?? String(a.normalizedValue ?? "—")}</span>
                      <span
                        aria-label={a.passed === null ? "not evaluated" : a.passed ? "passed" : "failed"}
                        title={a.passed === null ? "not evaluated" : a.passed ? "passed" : "failed"}
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "var(--label-2)",
                          padding: "2px 7px",
                          borderRadius: "var(--radius-xs)",
                          background: a.passed ? "var(--ink-900)" : "var(--ink-100)",
                          color: a.passed ? "var(--white)" : "var(--ink-700)",
                        }}
                      >
                        {a.passed === null ? "–" : a.passed ? "✓" : "✕"}
                      </span>
                    </dd>
                  </div>
                ))
              )}
            </dl>
          </div>

          {/* ---- Lead data ---- */}
          <div className={styles.panel}>
            <div className={detail.panelHead}>Lead data</div>
            <dl style={{ margin: 0 }}>
              {fields.map((f) => (
                <div key={f.label} className={detail.fieldRow}>
                  <dt className={styles.mono} style={{ letterSpacing: ".1em", margin: 0 }}>
                    {f.label}
                  </dt>
                  <dd style={{ fontSize: "var(--body-3)", color: "var(--text-strong)", textAlign: "right", margin: 0 }}>
                    {f.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/* ---- Call attempts ---- */}
          <div className={styles.panel}>
            <div className={detail.panelHead} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
              <span>Call attempts</span>
              <span className={styles.mono} style={{ letterSpacing: ".1em" }}>
                {`${lead.attempts.length} of ${MAX_ATTEMPTS} attempts used`}
              </span>
            </div>
            <div style={{ padding: "18px 20px 4px" }}>
              {lead.attempts.map((a) => {
                const live = Boolean(a.startedAt && !a.endedAt);
                return (
                  <div key={a.id} style={{ display: "grid", gridTemplateColumns: "28px 1fr", gap: "var(--space-3)" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                      <div
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: "50%",
                          border: live ? "1px solid var(--ink-900)" : "1px solid var(--line-hairline)",
                          background: live ? "var(--ink-900)" : "var(--white)",
                          color: live ? "var(--white)" : "var(--ink-900)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontFamily: "var(--font-mono)",
                          fontSize: "var(--label-1)",
                          flex: "0 0 auto",
                        }}
                      >
                        {a.attemptNumber}
                      </div>
                      <div style={{ flex: 1, width: 1, background: "var(--line-hairline)", minHeight: 14 }} />
                    </div>
                    <div style={{ paddingBottom: 18 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)", flexWrap: "wrap" }}>
                        <span style={{ fontSize: "var(--body-2)", fontWeight: 500, color: "var(--text-strong)" }}>
                          {outcomeLabel(a)}
                        </span>
                        <span className={styles.mono} style={{ letterSpacing: ".08em" }}>
                          {formatDateTime(a.startedAt ?? a.scheduledAt)}
                        </span>
                        <span className={styles.mono} style={{ letterSpacing: ".08em" }}>
                          {formatDuration(a.startedAt, a.endedAt)}
                        </span>
                      </div>
                      {a.endedReason ? (
                        <div style={{ fontSize: "var(--body-3)", lineHeight: 1.55, color: "var(--text-muted)", marginTop: 5, textWrap: "pretty" }}>
                          {a.endedReason}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {lead.attempts.length === 0 ? (
                <div style={{ padding: "0 0 20px", fontSize: "var(--body-3)", color: "var(--text-muted)" }}>
                  {lead.nextCallAt
                    ? `No call attempts yet — the first call is scheduled for ${formatDateTime(lead.nextCallAt)}.`
                    : "No call attempts yet."}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* ---- Transcript ---- */}
        <div className={styles.panel}>
          <div className={detail.panelHead} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
            <div>
              <div>Call transcript</div>
              <div className={styles.mono} style={{ letterSpacing: ".1em", marginTop: 4 }}>
                {transcriptAttempt
                  ? `Attempt ${transcriptAttempt.attemptNumber} · ${formatDateTime(transcriptAttempt.startedAt)} · ${formatDuration(
                      transcriptAttempt.startedAt,
                      transcriptAttempt.endedAt,
                    )} · ${languageLabel(lead.preferredCallLanguage)}`
                  : "No completed conversation"}
              </div>
            </div>
            <span className={styles.mono} style={{ letterSpacing: ".1em" }}>
              audio not stored
            </span>
          </div>

          {transcriptAttempt?.transcript ? (
            <div className={detail.transcript}>
              {transcriptAttempt.transcript.map((turn, i) => {
                const fromAi = turn.who === "ai";
                return (
                  <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: fromAi ? "flex-start" : "flex-end" }}>
                    <div className={styles.mono} style={{ letterSpacing: ".14em", marginBottom: 5 }}>
                      {fromAi ? "AI agent" : lead.name}
                    </div>
                    <div
                      style={{
                        maxWidth: "84%",
                        background: fromAi ? "var(--ink-900)" : "var(--white)",
                        color: fromAi ? "var(--text-onDark)" : "var(--text-strong)",
                        border: fromAi ? "1px solid var(--ink-900)" : "1px solid var(--line-hairline)",
                        borderRadius: "var(--radius-md)",
                        padding: "12px 15px",
                        fontSize: "var(--body-2)",
                        lineHeight: 1.55,
                        textWrap: "pretty",
                      }}
                    >
                      {turn.text}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: "78px 30px 84px", textAlign: "center" }}>
              <div
                style={{
                  width: 46,
                  height: 46,
                  margin: "0 auto",
                  borderRadius: "var(--radius-md)",
                  border: "1px dashed var(--line-track)",
                  background: "var(--ink-050)",
                }}
              />
              <div
                style={{
                  marginTop: "var(--space-4)",
                  fontSize: "var(--title-2)",
                  fontWeight: 500,
                  textTransform: "uppercase",
                  letterSpacing: "var(--title-tracking)",
                  color: "var(--text-strong)",
                }}
              >
                No transcript yet
              </div>
              <p style={{ fontSize: "var(--body-3)", lineHeight: 1.55, color: "var(--text-muted)", margin: "var(--space-2) auto 0", maxWidth: 300, textWrap: "pretty" }}>
                {transcriptNote(lead.status)}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
