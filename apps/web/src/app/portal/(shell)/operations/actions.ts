"use server";

import { SETTING_KEYS, getDb, updateSetting } from "@solarwave/db";
import { revalidatePath } from "next/cache";
import { ForbiddenError, requireAdmin } from "@/lib/auth";
import type { OperationsState } from "./state";

const fail = (prev: OperationsState, message: string, fieldErrors: Record<string, string> = {}): OperationsState => ({
  ok: false,
  message,
  fieldErrors,
  nonce: prev.nonce + 1,
});

/**
 * Saves the operational envelope (lifecycle-and-operations D4).
 *
 * Admin-only, and audited by `updateSetting` itself — which is the property
 * that lets automatic dispatch ship OFF in data rather than being forced off in
 * code. Turning it on is a recorded act with an employee's name on it.
 */
export async function saveOperationsAction(prev: OperationsState, formData: FormData): Promise<OperationsState> {
  let actorId: string;
  try {
    actorId = (await requireAdmin()).id;
  } catch (e) {
    return fail(prev, e instanceof ForbiddenError ? e.message : "Not allowed");
  }

  const enabled = formData.get("autoDispatchEnabled") === "on";
  const dailyCallBudget = Number(String(formData.get("dailyCallBudget") ?? ""));
  const monthlyVoiceMinutes = Number(String(formData.get("monthlyVoiceMinutes") ?? ""));

  if (!Number.isInteger(dailyCallBudget) || dailyCallBudget < 0) {
    return fail(prev, "Please fix the highlighted fields.", {
      [SETTING_KEYS.dailyCallBudget]: "A whole number of calls, zero or more.",
    });
  }
  if (!Number.isInteger(monthlyVoiceMinutes) || monthlyVoiceMinutes < 0) {
    return fail(prev, "Please fix the highlighted fields.", {
      [SETTING_KEYS.monthlyVoiceSecondsBudget]: "A whole number of minutes, zero or more.",
    });
  }

  const db = getDb();
  const writes = [
    await updateSetting(db, SETTING_KEYS.autoDispatchEnabled, enabled, actorId),
    await updateSetting(db, SETTING_KEYS.dailyCallBudget, dailyCallBudget, actorId),
    await updateSetting(db, SETTING_KEYS.monthlyVoiceSecondsBudget, monthlyVoiceMinutes * 60, actorId),
  ];

  const broken = writes.find((w) => !w.ok);
  if (broken && !broken.ok) {
    return fail(prev, "Please fix the highlighted fields.", { [broken.error.field]: broken.error.message });
  }

  revalidatePath("/portal/operations");
  revalidatePath("/portal", "layout");
  return {
    ok: true,
    message: enabled ? "Saved. Automatic dispatch is ON." : "Saved. Automatic dispatch is off.",
    fieldErrors: {},
    nonce: prev.nonce + 1,
  };
}
