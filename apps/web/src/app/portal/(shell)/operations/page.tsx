import { getBudgetConsumption, getDb, getOperationsSettings } from "@solarwave/db";
import { OperationsPanel } from "@/components/app/OperationsPanel";
import { requireEmployee } from "@/lib/auth";

export const metadata = { title: "Operations · SolarWave console" };
export const dynamic = "force-dynamic";

/**
 * The operational envelope (lifecycle-and-operations D4, `lead-portal` spec).
 *
 * Readable by an agent, editable only by an admin — the same rule the criteria
 * settings follow, and enforced in the action rather than by hiding the form.
 */
export default async function OperationsPage() {
  const employee = await requireEmployee();
  const db = getDb();
  const [settings, consumption] = await Promise.all([getOperationsSettings(db), getBudgetConsumption(db)]);

  return <OperationsPanel settings={settings} consumption={consumption} canEdit={employee.role === "admin"} />;
}
