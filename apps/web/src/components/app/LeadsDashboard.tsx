"use client";

import type { Kpis, StatusCounts } from "@solarwave/db";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { DisplayHeading, PillButton } from "@/components/ds/soltera";
import {
  STATUS,
  STATUS_KEYS,
  formatDateTime,
  formatPhone,
  scoreColor,
  type Lead,
  type LeadStatus,
} from "@/lib/leads";
import styles from "@/app/portal/portal.module.css";

const COLUMNS = "1.15fr 0.95fr 1.15fr 84px 1.5fr 1.6fr 138px";
const MIN_TABLE_WIDTH = 1080;

type Props = {
  rows: Lead[];
  counts: StatusCounts;
  kpis: Kpis;
  threshold: number;
  statusFilter: LeadStatus | "all";
  query: string;
};

function hrefFor(status: string, query: string): string {
  const sp = new URLSearchParams();
  if (status !== "all") sp.set("status", status);
  if (query) sp.set("q", query);
  const qs = sp.toString();
  return qs ? `/portal/leads?${qs}` : "/portal/leads";
}

export function LeadsDashboard({ rows, counts, kpis, threshold, statusFilter, query }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState(query);

  // Debounced search -> URL, so the Server Component re-queries.
  useEffect(() => {
    if (search === query) return;
    const handle = setTimeout(() => {
      startTransition(() => router.replace(hrefFor(statusFilter, search.trim())));
    }, 250);
    return () => clearTimeout(handle);
  }, [search, query, statusFilter, router]);

  const qualifiedRate = kpis.total > 0 ? Math.round((100 * kpis.qualified) / kpis.total) : 0;
  const tiles = [
    { label: "New today", value: String(kpis.newToday), delta: `${kpis.total} total` },
    { label: "Qualified", value: String(kpis.qualified), delta: `${qualifiedRate}% rate` },
    {
      label: "Awaiting retry",
      value: String(kpis.awaitingRetry),
      delta: kpis.nextRetryAt ? `next ${formatDateTime(kpis.nextRetryAt)}` : "no retry scheduled",
    },
    { label: "Median score", value: kpis.medianScore === null ? "—" : String(kpis.medianScore), delta: `hand-off at ${threshold}` },
  ];

  const isEmpty = rows.length === 0;
  const filtered = statusFilter !== "all" || query.length > 0;

  return (
    <div className={styles.screen}>
      <div className={styles.screenHead}>
        <div>
          <DisplayHeading size="var(--display-3)">Leads</DisplayHeading>
          <p style={{ fontSize: "var(--body-2)", color: "var(--text-muted)", margin: "var(--space-2) 0 0" }}>
            {isPending ? "Refreshing…" : `${rows.length} of ${counts.all} leads shown`}
          </p>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: "var(--space-3)",
          marginTop: "var(--space-6)",
        }}
      >
        {tiles.map((k) => (
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
              <Link
                key={key}
                href={hrefFor(key, query)}
                aria-pressed={active}
                className={styles.badge}
                style={{
                  background: active ? "var(--ink-900)" : (style?.bg ?? "var(--white)"),
                  color: active ? "var(--white)" : (style?.fg ?? "var(--text-body)"),
                  border: active ? "1px solid var(--ink-900)" : (style?.border ?? "1px solid var(--line-hairline)"),
                  padding: "6px 12px",
                  transition: "all var(--dur-base) var(--ease-out)",
                  textDecoration: "none",
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
              </Link>
            );
          })}
        </div>

        <div style={{ flex: 1, minWidth: 240, display: "flex", justifyContent: "flex-end" }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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

      <div className={styles.panel} style={{ marginTop: "var(--space-4)", opacity: isPending ? 0.6 : 1, transition: "opacity var(--dur-base)" }}>
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
                {filtered ? "No leads match these filters" : "No leads yet"}
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
                {filtered
                  ? `Try a different status or clear the search${query ? ` — you are filtering on “${query}”` : ""}.`
                  : "As soon as someone submits the form on the site, the lead lands here and the AI agent starts calling within the allowed window."}
              </p>
              {filtered ? (
                <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "center", marginTop: "var(--space-6)", flexWrap: "wrap" }}>
                  <PillButton
                    variant="ghost"
                    size="sm"
                    showKnob={false}
                    onClick={() => {
                      setSearch("");
                      startTransition(() => router.replace("/portal/leads"));
                    }}
                  >
                    Clear filters
                  </PillButton>
                </div>
              ) : null}
            </div>
          ) : (
            <div>
              {rows.map((lead) => {
                const badge = STATUS[lead.status];
                const colour = scoreColor(lead.score, threshold);
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
                        {formatDateTime(lead.createdAt)}
                      </div>
                    </div>
                    <div className={styles.truncate} style={{ fontFamily: "var(--font-mono)", fontSize: "var(--body-3)", color: "var(--text-body)" }}>
                      {formatPhone(lead.phone)}
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
                      {lead.qualificationReason ?? "—"}
                    </div>
                    <div className={styles.truncate} style={{ fontSize: "var(--body-3)", color: "var(--text-muted)" }}>
                      {lead.icebreaker ?? "—"}
                    </div>
                    <div>
                      <span className={styles.badge} style={{ background: badge.bg, color: badge.fg, border: badge.border }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: badge.fg, animation: badge.dot }} />
                        {badge.label}
                      </span>
                    </div>
                  </div>
                );
              })}
              <div className={styles.tfoot}>
                <span>{`Showing ${rows.length} of ${counts.all} leads`}</span>
                <span>Reload to refresh</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
