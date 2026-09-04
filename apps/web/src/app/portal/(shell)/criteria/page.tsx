import { getDb, getSettings, listAudit, listCriteria } from "@solarwave/db";
import { CriteriaManager } from "@/components/app/CriteriaManager";
import { requireEmployee } from "@/lib/auth";

export const metadata = { title: "Criteria · SolarWave console" };
export const dynamic = "force-dynamic";

export default async function CriteriaPage() {
  const employee = await requireEmployee();
  const db = getDb();
  const [criteria, settings, recentAudit] = await Promise.all([listCriteria(db), getSettings(db), listAudit(db, 3)]);

  return (
    <CriteriaManager
      criteria={criteria}
      settings={settings}
      recentAudit={recentAudit.map((a) => ({
        id: a.id,
        employee: a.employeeName ?? "Unknown",
        when: a.changedAt,
        criterion: a.criterionLabel ?? a.field.replace(/^setting:/, "setting "),
        field: a.field,
        oldValue: a.oldValue,
        newValue: a.newValue,
      }))}
      canEdit={employee.role === "admin"}
    />
  );
}
