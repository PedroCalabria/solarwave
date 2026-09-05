import { countAudit, countLeadsByStatus, countUnreviewedViolations, getDb, listActiveCriteria } from "@solarwave/db";
import { PortalSidebar } from "@/components/app/PortalSidebar";
import { requireEmployee } from "@/lib/auth";
import styles from "../portal.module.css";

export const dynamic = "force-dynamic";

export default async function PortalShellLayout({ children }: { children: React.ReactNode }) {
  const employee = await requireEmployee();
  const db = getDb();
  const [counts, activeCriteria, auditCount, unreviewed] = await Promise.all([
    countLeadsByStatus(db),
    listActiveCriteria(db),
    countAudit(db),
    countUnreviewedViolations(db),
  ]);

  return (
    <div className={styles.shell}>
      <PortalSidebar
        employee={{ name: employee.name, role: employee.role }}
        counts={{ leads: counts.all, criteria: activeCriteria.length, audit: auditCount, violations: unreviewed }}
      />
      <div className={styles.content}>{children}</div>
    </div>
  );
}
