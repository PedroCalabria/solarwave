import { countLeadsByStatus, getDb, getKpis, getSettings, listLeads } from "@solarwave/db";
import { LeadsDashboard } from "@/components/app/LeadsDashboard";
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
  const [rows, counts, kpis, settings] = await Promise.all([
    listLeads(db, { status: statusFilter, query }),
    countLeadsByStatus(db),
    getKpis(db, PORTAL_TZ),
    getSettings(db),
  ]);

  return (
    <LeadsDashboard
      rows={rows}
      counts={counts}
      kpis={kpis}
      threshold={settings.handoffThreshold}
      statusFilter={statusFilter}
      query={query}
    />
  );
}
