import Link from "next/link";
import { notFound } from "next/navigation";
import { DisplayHeading, PillButton } from "@/components/ds/soltera";
import { LEADS, MAX_ATTEMPTS, STATUS, getLead, scoreColor } from "@/lib/leads";
import styles from "../../../portal.module.css";
import detail from "./detail.module.css";

export function generateStaticParams() {
  return LEADS.map((lead) => ({ id: lead.id }));
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const lead = getLead(id);
  if (!lead) notFound();

  const badge = STATUS[lead.status];
  const colour = scoreColor(lead.score);
  const fields = [
    { label: "Phone", value: lead.phone },
    { label: "Email", value: lead.email },
    { label: "Location", value: lead.city },
    { label: "Source", value: lead.source },
    { label: "Monthly bill", value: lead.bill },
    { label: "Roof", value: lead.roof },
    { label: "Ownership", value: lead.owner },
    { label: "Timeline", value: lead.timeline },
    { label: "Consent", value: lead.consent },
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
              style={{
                background: badge.bg,
                color: badge.fg,
                border: badge.border,
                fontSize: "var(--label-1)",
                padding: "6px 12px",
              }}
            >
              <span
                style={{ width: 6, height: 6, borderRadius: "50%", background: badge.fg, animation: badge.dot }}
              />
              {badge.label}
            </span>
          </div>
          <div style={{ fontSize: "var(--body-3)", color: "var(--text-muted)", marginTop: "var(--space-2)" }}>
            {`${lead.city} · ${lead.source} · created ${lead.created} · call language ${
              lead.callLang === "en" ? "English" : "Portuguese"
            }`}
          </div>
        </div>

        <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
          <PillButton variant="ghost" size="sm" showKnob={false}>
            Assign to me
          </PillButton>
          <PillButton variant="ghost" size="sm" showKnob={false}>
            Disqualify
          </PillButton>
          <PillButton variant="primary" size="sm" icon="arrow-up-right">
            Hand to sales
          </PillButton>
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
              <div style={{ fontSize: "var(--body-3)", color: "var(--text-muted)", textAlign: "right", maxWidth: 160, textWrap: "pretty" }}>
                {lead.scoreNote}
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
                {lead.reason}
              </p>
            </div>

            <div style={{ marginTop: "var(--space-4)", background: "var(--surface-invert)", borderRadius: "var(--radius-md)", padding: 16 }}>
              <div className={styles.mono} style={{ color: "rgba(255,255,255,.6)" }}>
                Icebreaker
              </div>
              <p style={{ fontSize: "var(--body-2)", lineHeight: 1.55, color: "var(--text-onDark)", margin: "var(--space-2) 0 0", textWrap: "pretty" }}>
                {lead.icebreaker}
              </p>
            </div>
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
              {lead.attempts.map((a) => (
                <div key={a.n} style={{ display: "grid", gridTemplateColumns: "28px 1fr", gap: "var(--space-3)" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: "50%",
                        border: a.live ? "1px solid var(--ink-900)" : "1px solid var(--line-hairline)",
                        background: a.live ? "var(--ink-900)" : "var(--white)",
                        color: a.live ? "var(--white)" : "var(--ink-900)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--label-1)",
                        flex: "0 0 auto",
                      }}
                    >
                      {a.n}
                    </div>
                    <div style={{ flex: 1, width: 1, background: "var(--line-hairline)", minHeight: 14 }} />
                  </div>
                  <div style={{ paddingBottom: 18 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "var(--body-2)", fontWeight: 500, color: "var(--text-strong)" }}>
                        {a.result}
                      </span>
                      <span className={styles.mono} style={{ letterSpacing: ".08em" }}>
                        {a.when}
                      </span>
                      <span className={styles.mono} style={{ letterSpacing: ".08em" }}>
                        {a.duration}
                      </span>
                    </div>
                    <div style={{ fontSize: "var(--body-3)", lineHeight: 1.55, color: "var(--text-muted)", marginTop: 5, textWrap: "pretty" }}>
                      {a.note}
                    </div>
                  </div>
                </div>
              ))}
              {lead.attempts.length === 0 ? (
                <div style={{ padding: "0 0 20px", fontSize: "var(--body-3)", color: "var(--text-muted)" }}>
                  No call attempts yet — the first call is queued.
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
                {lead.transcriptMeta}
              </div>
            </div>
            <PillButton variant="ghost" size="sm" icon="play">
              Play recording
            </PillButton>
          </div>

          {lead.transcript ? (
            <div className={detail.transcript}>
              {lead.transcript.map((turn, i) => {
                const fromAi = turn.who === "ai";
                return (
                  <div
                    key={i}
                    style={{ display: "flex", flexDirection: "column", alignItems: fromAi ? "flex-start" : "flex-end" }}
                  >
                    <div
                      className={styles.mono}
                      style={{ letterSpacing: ".14em", marginBottom: 5 }}
                    >
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
                {lead.noTranscriptNote}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
