import { countLeadsByStatus, getDb, getKpis, getSettings, listLeads, listScoringPendings } from "@solarwave/db";
import { LeadsDashboard } from "@/components/app/LeadsDashboard";
import { ScoringPendings } from "@/components/app/ScoringPendings";
import { isLeadStatus } from "@/lib/leads";

export const metadata = { title: "Leads · SolarWave console" };
export const dynamic = "force-dynamic";

const PORTAL_TZ = process.env.PORTAL_TIMEZONE ?? "America/Sao_Paulo";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { status, q } = await searchParams;
  const statusFilter = status && isLeadStatus(status) ? status : "all";
  const query = q?.trim() ?? "";

  const db = getDb();
  const [rows, counts, kpis, settings, pendings] = await Promise.all([
    listLeads(db, { status: statusFilter, query }),
    countLeadsByStatus(db),
    getKpis(db, PORTAL_TZ),
    getSettings(db),
    listScoringPendings(db),
  ]);

  const formatEnded = (value: Date | null) =>
    value
      ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: PORTAL_TZ }).format(value)
      : null;

  return (
    <>
      {pendings.length > 0 ? (
        <div style={{ padding: "var(--space-6) var(--space-6) 0" }}>
          <ScoringPendings pendings={pendings.map((p) => ({ ...p, endedAt: formatEnded(p.endedAt) }))} />
        </div>
      ) : null}
      <LeadsDashboard
        rows={rows}
        counts={counts}
        kpis={kpis}
        threshold={settings.handoffThreshold}
        statusFilter={statusFilter}
        query={query}
      />
    </>
  );
}
