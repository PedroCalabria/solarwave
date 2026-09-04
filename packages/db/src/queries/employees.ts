import { eq } from "drizzle-orm";
import type { DbOrTx } from "../client";
import { employees, type Employee, type EmployeeRole } from "../schema";

/** Looks up the employee row for a Supabase Auth user id. Callers check `active`. */
export async function getEmployeeByAuthUserId(db: DbOrTx, authUserId: string): Promise<Employee | null> {
  const rows = await db.select().from(employees).where(eq(employees.id, authUserId)).limit(1);
  return rows[0] ?? null;
}

export async function upsertEmployee(
  db: DbOrTx,
  input: { id: string; name: string; email: string; role: EmployeeRole; active?: boolean },
): Promise<Employee> {
  const [row] = await db
    .insert(employees)
    .values({ ...input, active: input.active ?? true })
    .onConflictDoUpdate({
      target: employees.id,
      set: { name: input.name, email: input.email, role: input.role, active: input.active ?? true, updatedAt: new Date() },
    })
    .returning();
  return row!;
}
