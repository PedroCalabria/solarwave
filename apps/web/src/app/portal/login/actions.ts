"use server";

import { getDb, getEmployeeByAuthUserId } from "@solarwave/db";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, supabaseEnv } from "@/lib/supabase/server";

export type SignInState = { error: string | null };

export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");

  if (!email || !password) return { error: "Enter your work email and password." };
  if (!supabaseEnv()) return { error: "Authentication is not configured on this deployment." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: "Email or password is incorrect." };

  const employee = await getEmployeeByAuthUserId(getDb(), data.user.id);
  if (!employee || !employee.active) {
    await supabase.auth.signOut();
    return { error: "This account is not an active SolarWave employee." };
  }

  redirect(next.startsWith("/portal/") && next !== "/portal/login" ? next : "/portal/leads");
}

export async function signOutAction(): Promise<void> {
  if (supabaseEnv()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect("/portal/login");
}
