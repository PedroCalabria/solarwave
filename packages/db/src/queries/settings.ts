import {
  DEFAULT_OPERATIONS_SETTINGS,
  DEFAULT_SETTINGS,
  type OperationsSettings,
  type ScoringSettings,
} from "@solarwave/core";
import { eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "../client";
import { BOOLEAN_SETTING_KEYS, SETTING_KEYS, settings } from "../schema";
import { appendAudit } from "./audit";

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

/**
 * A setting is a number or a switch (lifecycle-and-operations, criteria-management
 * spec). `auto_dispatch_enabled` is the reason: representing a switch as 0 or 1
 * in an administrator's interface obscures what it does, and the audit entry
 * would read "0 -> 1" for the act of letting the machine spend a free-tier
 * allowance unattended.
 */
export type SettingValue = number | boolean;

export function isBooleanSetting(key: SettingKey): boolean {
  return BOOLEAN_SETTING_KEYS.includes(key);
}

export async function getSettings(db: DbOrTx): Promise<ScoringSettings> {
  const rows = await db
    .select()
    .from(settings)
    .where(inArray(settings.key, [SETTING_KEYS.handoffThreshold, SETTING_KEYS.minAnsweredWeightShare]));
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const threshold = byKey.get(SETTING_KEYS.handoffThreshold);
  const share = byKey.get(SETTING_KEYS.minAnsweredWeightShare);
  return {
    handoffThreshold: typeof threshold === "number" ? threshold : DEFAULT_SETTINGS.handoffThreshold,
    minAnsweredWeightShare: typeof share === "number" ? share : DEFAULT_SETTINGS.minAnsweredWeightShare,
  };
}

export type SettingError = { field: SettingKey; message: string };

export function validateSetting(key: SettingKey, value: SettingValue): SettingError | null {
  // The shape check comes first, and it runs both ways: a switch given a number
  // and a number given a switch are equally wrong, and letting either through
  // would store a value nothing downstream knows how to read.
  if (isBooleanSetting(key)) {
    if (typeof value !== "boolean") return { field: key, message: "must be true or false" };
    return null;
  }
  if (typeof value !== "number") return { field: key, message: "must be a number" };

  if (!Number.isFinite(value)) return { field: key, message: "must be a number" };
  if (key === SETTING_KEYS.handoffThreshold && (!Number.isInteger(value) || value < 0 || value > 100)) {
    return { field: key, message: "threshold must be an integer between 0 and 100" };
  }
  if (key === SETTING_KEYS.minAnsweredWeightShare && (value < 0 || value > 1)) {
    return { field: key, message: "share must be between 0 and 1" };
  }
  if (key === SETTING_KEYS.dailyCallBudget && (!Number.isInteger(value) || value < 0)) {
    return { field: key, message: "daily call budget must be a whole number of calls, zero or more" };
  }
  if (key === SETTING_KEYS.monthlyVoiceSecondsBudget && (!Number.isInteger(value) || value < 0)) {
    return { field: key, message: "voice budget must be a whole number of seconds, zero or more" };
  }
  return null;
}

/**
 * The operational envelope, with the defaults applied for anything unset.
 *
 * Reads defensively: a value of the wrong type falls back to the default rather
 * than propagating. The alternative is a malformed row silently disabling the
 * brake, which is the one failure this setting exists to prevent.
 */
export async function getOperationsSettings(db: DbOrTx): Promise<OperationsSettings> {
  const rows = await db
    .select()
    .from(settings)
    .where(
      inArray(settings.key, [
        SETTING_KEYS.autoDispatchEnabled,
        SETTING_KEYS.dailyCallBudget,
        SETTING_KEYS.monthlyVoiceSecondsBudget,
      ]),
    );
  const byKey = new Map(rows.map((r) => [r.key, r.value]));

  const enabled = byKey.get(SETTING_KEYS.autoDispatchEnabled);
  const daily = byKey.get(SETTING_KEYS.dailyCallBudget);
  const monthly = byKey.get(SETTING_KEYS.monthlyVoiceSecondsBudget);

  return {
    autoDispatchEnabled:
      typeof enabled === "boolean" ? enabled : DEFAULT_OPERATIONS_SETTINGS.autoDispatchEnabled,
    dailyCallBudget:
      typeof daily === "number" && Number.isInteger(daily) && daily >= 0
        ? daily
        : DEFAULT_OPERATIONS_SETTINGS.dailyCallBudget,
    monthlyVoiceSecondsBudget:
      typeof monthly === "number" && Number.isInteger(monthly) && monthly >= 0
        ? monthly
        : DEFAULT_OPERATIONS_SETTINGS.monthlyVoiceSecondsBudget,
  };
}

/**
 * Upserts a setting — numeric or a switch — and writes the audit row in the
 * same transaction (field = "setting:<key>", criteria_id null).
 *
 * The audit is what makes enabling automatic dispatch an act with a name and a
 * timestamp on it, which is the property that lets the brake ship off in data
 * rather than being enforced in code.
 */
export async function updateSetting(
  tx: DbOrTx,
  key: SettingKey,
  value: SettingValue,
  actorId: string,
): Promise<{ ok: true; previous: SettingValue | null } | { ok: false; error: SettingError }> {
  const invalid = validateSetting(key, value);
  if (invalid) return { ok: false, error: invalid };

  const existing = await tx.select().from(settings).where(eq(settings.key, key)).limit(1);
  const stored = existing[0]?.value;
  const previous: SettingValue | null =
    typeof stored === "number" || typeof stored === "boolean" ? (stored as SettingValue) : null;

  await tx
    .insert(settings)
    .values({ key, value, updatedBy: actorId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: actorId, updatedAt: new Date() } });

  if (previous !== value) {
    await appendAudit(tx, [
      {
        criteriaId: null,
        changedBy: actorId,
        field: `setting:${key}`,
        oldValue: previous === null ? null : String(previous),
        newValue: String(value),
      },
    ]);
  }
  return { ok: true, previous };
}
