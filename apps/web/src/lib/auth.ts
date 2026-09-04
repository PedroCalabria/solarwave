import "server-only";

import { getDb, getEmployeeByAuthUserId, type Employee } from "@solarwave/db";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createSupabaseServerClient, supabaseEnv } from "./supabase/server";

export type CurrentEmployee = Employee;

/**
 * Data Access Layer entry point. Resolves the Supabase session to an active
 * `employees` row. Memoised per render pass. Returns `null` when there is no
 * session, no employee row, or the employee is deactivated.
 */
export const getCurrentEmployee = cache(async (): Promise<CurrentEmployee | null> => {
  if (!supabaseEnv()) return null;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const employee = await getEmployeeByAuthUserId(getDb(), user.id);
  if (!employee || !employee.active) return null;
  return employee;
});

/** For Server Components: redirects to the login page when not signed in as an employee. */
export async function requireEmployee(): Promise<CurrentEmployee> {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/portal/login?error=not_employee");
  return employee;
}

export class ForbiddenError extends Error {
  constructor(message = "Only admins can perform this action") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** For Server Actions: throws instead of redirecting so the caller can show an error. */
export async function requireAdmin(): Promise<CurrentEmployee> {
  const employee = await getCurrentEmployee();
  if (!employee) throw new ForbiddenError("Not signed in");
  if (employee.role !== "admin") throw new ForbiddenError();
  return employee;
}
