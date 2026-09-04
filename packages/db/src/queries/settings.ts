import { DEFAULT_SETTINGS, type ScoringSettings } from "@solarwave/core";
import { eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "../client";
import { SETTING_KEYS, settings } from "../schema";
import { appendAudit } from "./audit";

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

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

export function validateSetting(key: SettingKey, value: number): SettingError | null {
  if (!Number.isFinite(value)) return { field: key, message: "must be a number" };
  if (key === SETTING_KEYS.handoffThreshold && (!Number.isInteger(value) || value < 0 || value > 100)) {
    return { field: key, message: "threshold must be an integer between 0 and 100" };
  }
  if (key === SETTING_KEYS.minAnsweredWeightShare && (value < 0 || value > 1)) {
    return { field: key, message: "share must be between 0 and 1" };
  }
  return null;
}

/**
 * Upserts a numeric setting and writes the audit row in the same transaction
 * (field = "setting:<key>", criteria_id null).
 */
export async function updateSetting(
  tx: DbOrTx,
  key: SettingKey,
  value: number,
  actorId: string,
): Promise<{ ok: true; previous: number | null } | { ok: false; error: SettingError }> {
  const invalid = validateSetting(key, value);
  if (invalid) return { ok: false, error: invalid };

  const existing = await tx.select().from(settings).where(eq(settings.key, key)).limit(1);
  const previous = typeof existing[0]?.value === "number" ? (existing[0].value as number) : null;

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
