"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DisplayHeading, PillButton } from "@/components/ds/soltera";
import {
  LEADS,
  KPIS,
  STATUS,
  STATUS_KEYS,
  filterLeads,
  scoreColor,
  statusCounts,
} from "@/lib/leads";
import styles from "@/app/portal/portal.module.css";

const COLUMNS = "1.15fr 0.95fr 1.15fr 84px 1.5fr 1.6fr 138px";
const MIN_TABLE_WIDTH = 1080;

/** The prototype exposed these as a prop so reviewers could inspect each state. */
type DataState = "data" | "loading" | "empty";

const STATE_BUTTONS: { id: DataState; label: string }[] = [
  { id: "data", label: "With data" },
  { id: "loading", label: "Loading" },
  { id: "empty", label: "Empty" },
];

export function LeadsDashboard() {
  const router = useRouter();
  const [dataState, setDataState] = useState<DataState>("data");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => statusCounts(), []);
  const rows = useMemo(
    () => filterLeads(LEADS, statusFilter, query),
    [statusFilter, query],
  );

  const isLoading = dataState === "loading";
  const isEmpty = dataState === "empty" || (dataState === "data" && rows.length === 0);
  const hasRows = dataState === "data" && rows.length > 0;

  return (
    <div className={styles.screen}>
      <div className={styles.screenHead}>
        <div>
          <DisplayHeading size="var(--display-3)">Leads</DisplayHeading>
          <p style={{ fontSize: "var(--body-2)", color: "var(--text-muted)", margin: "var(--space-2) 0 0" }}>
            {isLoading
              ? "Syncing with the call agent…"
              : `${rows.length} of ${LEADS.length} leads shown · updated just now`}
          </p>
        </div>

        <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
          {STATE_BUTTONS.map((b) => {
            const on = dataState === b.id;
            return (
              <button
                key={b.id}
                type="button"
                aria-pressed={on}
                onClick={() => setDataState(b.id)}
                style={{
                  border: `1px solid ${on ? "var(--ink-900)" : "var(--line-hairline)"}`,
                  background: on ? "var(--ink-900)" : "var(--white)",
                  color: on ? "var(--white)" : "var(--text-muted)",
                  borderRadius: "var(--radius-pill)",
                  padding: "7px 13px",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--label-2)",
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  transition: "all var(--dur-base) var(--ease-out)",
                }}
              >
                {b.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "var(--space-3)", marginTop: "var(--space-6)" }}>
        {KPIS.map((k) => (
          <div key={k.label} style={{ background: "var(--surface-card)", borderRadius: "var(--radius-lg)", padding: "18px 20px" }}>
            <div className={styles.mono}>{k.label}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)", marginTop: "var(--space-3)", flexWrap: "wrap" }}>
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 600,
                  fontSize: "var(--display-3)",
                  letterSpacing: "-.02em",
                  color: "var(--text-strong)",
                }}
              >
                {k.value}
              </span>
              <span className={styles.mono} style={{ letterSpacing: ".08em" }}>
                {k.delta}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginTop: "var(--space-6)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {(["all", ...STATUS_KEYS] as const).map((key) => {
            const active = statusFilter === key;
            const style = key === "all" ? null : STATUS[key];
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => setStatusFilter(key)}
                className={styles.badge}
                style={{
                  background: active ? "var(--ink-900)" : (style?.bg ?? "var(--white)"),
                  color: active ? "var(--white)" : (style?.fg ?? "var(--text-body)"),
                  border: active
                    ? "1px solid var(--ink-900)"
                    : (style?.border ?? "1px solid var(--line-hairline)"),
                  padding: "6px 12px",
                  transition: "all var(--dur-base) var(--ease-out)",
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: active ? "var(--white)" : (style?.fg ?? "var(--ink-400)"),
                  }}
                />
                {key === "all" ? "All" : style?.label}
                <span style={{ opacity: 0.55 }}>{counts[key] ?? 0}</span>
              </button>
            );
          })}
        </div>

        <div style={{ flex: 1, minWidth: 240, display: "flex", justifyContent: "flex-end" }}>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setDataState("data");
            }}
            placeholder="Search name, phone or email…"
            aria-label="Search leads"
            style={{
              width: 300,
              maxWidth: "100%",
              height: "var(--control-h-sm)",
              border: "1px solid var(--line-hairline)",
              background: "var(--white)",
              borderRadius: "var(--radius-pill)",
              padding: "0 16px",
              fontSize: "var(--body-2)",
              color: "var(--text-strong)",
              outline: "none",
            }}
          />
        </div>
      </div>

      <div className={styles.panel} style={{ marginTop: "var(--space-4)" }}>
        <div className={styles.tableScroll}>
          <div className={styles.thead} style={{ gridTemplateColumns: COLUMNS, minWidth: MIN_TABLE_WIDTH }}>
            <span>Name</span>
            <span>Phone</span>
            <span>Email</span>
            <span>Score</span>
            <span>Reason</span>
            <span>Icebreaker</span>
            <span>Status</span>
          </div>

          {isLoading ? (
            <div>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <div
                  key={n}
                  className={styles.trow}
                  style={{ gridTemplateColumns: COLUMNS, minWidth: MIN_TABLE_WIDTH, padding: "16px 20px" }}
                >
                  <div
                    style={{
                      height: 10,
                      borderRadius: 5,
                      width: "78%",
                      background:
                        "linear-gradient(90deg, var(--ink-100) 25%, var(--ink-050) 50%, var(--ink-100) 75%)",
                      backgroundSize: "420px 100%",
                      animation: "solShimmer 1300ms linear infinite",
                    }}
                  />
                  {["84%", "90%", "60%", "96%", "88%"].map((w, i) => (
                    <div key={i} style={{ height: 10, borderRadius: 5, background: "var(--ink-100)", width: w }} />
                  ))}
                  <div style={{ height: 22, borderRadius: 999, background: "var(--ink-100)", width: 92 }} />
                </div>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "14px 20px" }}>
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--ink-400)",
                    animation: "solPulse 1200ms var(--ease-out) infinite",
                  }}
                />
                <span className={styles.mono}>Loading leads</span>
              </div>
            </div>
          ) : null}

          {isEmpty ? (
            <div style={{ padding: "84px 30px 90px", textAlign: "center" }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  margin: "0 auto",
                  borderRadius: "var(--radius-md)",
                  border: "1px dashed var(--line-track)",
                  background: "var(--ink-050)",
                }}
              />
              <div
                style={{
                  marginTop: "var(--space-5)",
                  fontSize: "var(--title-1)",
                  fontWeight: 500,
                  textTransform: "uppercase",
                  letterSpacing: "var(--title-tracking)",
                  color: "var(--text-strong)",
                }}
              >
                {dataState === "empty" ? "No leads yet" : "No leads match these filters"}
              </div>
              <p
                style={{
                  fontSize: "var(--body-2)",
                  lineHeight: 1.55,
                  color: "var(--text-muted)",
                  margin: "var(--space-3) auto 0",
                  maxWidth: 420,
                  textWrap: "pretty",
                }}
              >
                {dataState === "empty"
                  ? "As soon as someone submits the form on the site, the lead lands here and the AI agent starts calling within five minutes."
                  : `Try a different status or clear the search — you are filtering on “${query}”.`}
              </p>
              <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "center", marginTop: "var(--space-6)", flexWrap: "wrap" }}>
                <PillButton
                  variant="ghost"
                  size="sm"
                  showKnob={false}
                  onClick={() => {
                    setStatusFilter("all");
                    setQuery("");
                    setDataState("data");
                  }}
                >
                  Clear filters
                </PillButton>
                <PillButton variant="primary" size="sm" icon="refresh-cw" onClick={() => setDataState("data")}>
                  Reload
                </PillButton>
              </div>
            </div>
          ) : null}

          {hasRows ? (
            <div>
              {rows.map((lead) => {
                const badge = STATUS[lead.status];
                const colour = scoreColor(lead.score);
                return (
                  <div
                    key={lead.id}
                    role="link"
                    tabIndex={0}
                    onClick={() => router.push(`/portal/leads/${lead.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        router.push(`/portal/leads/${lead.id}`);
                      }
                    }}
                    className={styles.trow}
                    style={{ gridTemplateColumns: COLUMNS, minWidth: MIN_TABLE_WIDTH, cursor: "pointer" }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--ink-050)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div className={styles.truncate} style={{ fontSize: "var(--body-2)", fontWeight: 500, color: "var(--text-strong)" }}>
                        {lead.name}
                      </div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--label-2)", color: "var(--text-muted)", marginTop: 3, letterSpacing: ".06em" }}>
                        {lead.created}
                      </div>
                    </div>
                    <div className={styles.truncate} style={{ fontFamily: "var(--font-mono)", fontSize: "var(--body-3)", color: "var(--text-body)" }}>
                      {lead.phone}
                    </div>
                    <div className={styles.truncate} style={{ fontSize: "var(--body-3)", color: "var(--text-body)" }}>
                      {lead.email}
                    </div>
                    <div>
                      <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 17, letterSpacing: "-.01em", color: colour }}>
                        {lead.score === null ? "—" : lead.score}
                      </div>
                      <div style={{ height: 2, background: "var(--line-track)", marginTop: 6, overflow: "hidden" }}>
                        <div
                          style={{
                            height: "100%",
                            width: `${lead.score ?? 0}%`,
                            background: colour,
                            transformOrigin: "left",
                            animation: "solGrow var(--dur-slow) var(--ease-out) both",
                          }}
                        />
                      </div>
                    </div>
                    <div className={styles.truncate} style={{ fontSize: "var(--body-3)", color: "var(--text-body)" }}>
                      {lead.reason}
                    </div>
                    <div className={styles.truncate} style={{ fontSize: "var(--body-3)", color: "var(--text-muted)" }}>
                      {lead.icebreaker}
                    </div>
                    <div>
                      <span
                        className={styles.badge}
                        style={{ background: badge.bg, color: badge.fg, border: badge.border }}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: badge.fg,
                            animation: badge.dot,
                          }}
                        />
                        {badge.label}
                      </span>
                    </div>
                  </div>
                );
              })}
              <div className={styles.tfoot}>
                <span>{`Showing ${rows.length} of ${LEADS.length} leads`}</span>
                <span>Auto-refresh 30s</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
