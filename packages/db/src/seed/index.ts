import { dddToTimezone, evaluateAnswer, scoreLead, type ScoringAnswer, type ScoringCriterion } from "@solarwave/core";
import { createClient } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStandaloneDb, type Db, type Tx } from "../client";
import { directDatabaseUrl } from "../env";
import {
  callAttempts,
  criteriaAuditLog,
  employees,
  leads,
  qualificationAnswers,
  qualificationCriteria,
  SETTING_KEYS,
  settings,
} from "../schema";
import { AUDIT, CRITERIA, EMPLOYEES, LEADS, SETTINGS, attemptId, criterionId, employeeId, leadId } from "./data";

const TRANSCRIPT_RETENTION_MONTHS = 12;

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/**
 * Creates (or finds) the Supabase Auth users for the demo employees WITHOUT the
 * service-role key: sign-up goes through the public endpoint with the
 * publishable/anon key, and the e-mail is confirmed with a SQL update over the
 * database connection we already hold. Returns the auth user id per seed
 * employee id; empty on plain Postgres, where nobody can sign in anyway.
 */
async function ensureAuthUsers(db: Db): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_ANON_KEY;

  const hasAuthSchema = await db
    .execute(sql`select 1 from information_schema.tables where table_schema = 'auth' and table_name = 'users'`)
    .then((rows) => (rows as unknown as unknown[]).length > 0)
    .catch(() => false);

  if (!hasAuthSchema) {
    console.warn("No Supabase Auth schema on this database: seeding employees without sign-in accounts.");
    return ids;
  }

  const wanted = EMPLOYEES.filter((e) => e.auth);
  const password = process.env.SEED_EMPLOYEE_PASSWORD ?? "solarwave-demo-2026";

  if (url && publishableKey) {
    const supabase = createClient(url, publishableKey, { auth: { autoRefreshToken: false, persistSession: false } });
    for (const emp of wanted) {
      // Idempotent: an existing e-mail either errors or returns an obfuscated
      // user; the SQL lookup below is the source of truth either way.
      const { error } = await supabase.auth.signUp({
        email: emp.email,
        password,
        options: { data: { name: emp.name } },
      });
      if (error && !/already|registered|exists/i.test(error.message)) {
        console.warn(`Sign-up for ${emp.email} failed: ${error.message}`);
      }
    }
  } else {
    console.warn("NEXT_PUBLIC_SUPABASE_URL / key not set: not creating sign-in accounts, only linking existing ones.");
  }

  // Confirm the demo accounts so they can sign in with a password, then read
  // back their ids. Both statements run as the project owner over Postgres.
  for (const emp of wanted) {
    await db.execute(
      sql`update auth.users set email_confirmed_at = now()
          where lower(email) = ${emp.email} and email_confirmed_at is null`,
    );
    const rows = (await db.execute(
      sql`select id::text as id from auth.users where lower(email) = ${emp.email} limit 1`,
    )) as unknown as Array<{ id: string }>;
    const id = rows[0]?.id;
    if (id) ids.set(emp.id, id);
    else console.warn(`No auth user for ${emp.email}: create it in the Supabase dashboard and re-run the seed.`);
  }
  return ids;
}

/**
 * An employee seeded before its auth user existed carries a fixture id. Move it
 * onto the real auth user id, re-pointing every reference, so re-running the
 * seed after creating the accounts converges instead of hitting the unique
 * e-mail index.
 */
async function relinkEmployee(tx: Tx, fromId: string, toId: string): Promise<void> {
  if (fromId === toId) return;
  const existing = await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, fromId)).limit(1);
  if (existing.length === 0) return;

  await tx.insert(employees).select(
    tx
      .select({
        id: sql<string>`${toId}::uuid`.as("id"),
        name: employees.name,
        email: employees.email,
        role: employees.role,
        active: employees.active,
        createdAt: employees.createdAt,
        updatedAt: employees.updatedAt,
      })
      .from(employees)
      .where(eq(employees.id, fromId)),
  );
  await tx.update(qualificationCriteria).set({ updatedBy: toId }).where(eq(qualificationCriteria.updatedBy, fromId));
  await tx.update(criteriaAuditLog).set({ changedBy: toId }).where(eq(criteriaAuditLog.changedBy, fromId));
  await tx.update(settings).set({ updatedBy: toId }).where(eq(settings.updatedBy, fromId));
  await tx.delete(employees).where(eq(employees.id, fromId));
  console.log(`Re-linked employee ${fromId} to auth user ${toId}.`);
}

export async function seed(db: Db): Promise<void> {
  const authIds = await ensureAuthUsers(db);
  /** Seed employee id -> actual employees.id (auth user id when available). */
  const empId = (seedId: string) => authIds.get(seedId) ?? seedId;

  await db.transaction(async (tx) => {
    // Employees
    for (const emp of EMPLOYEES) {
      await relinkEmployee(tx, emp.id, empId(emp.id));
      await tx
        .insert(employees)
        .values({ id: empId(emp.id), name: emp.name, email: emp.email, role: emp.role, active: emp.auth })
        .onConflictDoUpdate({
          target: employees.id,
          set: { name: emp.name, email: emp.email, role: emp.role, active: emp.auth, updatedAt: new Date() },
        });
    }

    // Settings
    for (const [key, value] of [
      [SETTING_KEYS.handoffThreshold, SETTINGS.handoffThreshold],
      [SETTING_KEYS.minAnsweredWeightShare, SETTINGS.minAnsweredWeightShare],
    ] as const) {
      await tx
        .insert(settings)
        .values({ key, value, updatedBy: empId(employeeId(1)) })
        .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
    }

    // Criteria
    for (const c of CRITERIA) {
      await tx
        .insert(qualificationCriteria)
        .values({ ...c, updatedBy: empId(employeeId(1)) })
        .onConflictDoUpdate({
          target: qualificationCriteria.id,
          set: {
            key: c.key,
            label: c.label,
            questionPt: c.questionPt,
            questionEn: c.questionEn,
            type: c.type,
            expectedValue: c.expectedValue,
            weight: c.weight,
            blocking: c.blocking,
            active: c.active,
            sortOrder: c.sortOrder,
            deletedAt: null,
            updatedAt: new Date(),
          },
        });
    }

    const scoringCriteria: ScoringCriterion[] = CRITERIA.map((c) => ({
      key: c.key,
      type: c.type,
      expectedValue: c.expectedValue,
      weight: c.weight,
      blocking: c.blocking,
      active: c.active,
    }));
    const criterionByKey = new Map(CRITERIA.map((c) => [c.key, c]));

    // Leads, attempts, answers
    for (const lead of LEADS) {
      const createdAt = new Date(lead.createdAt);
      const ddd = lead.phone.slice(3, 5);
      const tz = dddToTimezone(ddd);
      if (!tz.ok) throw new Error(`Seed lead ${lead.name} has an unknown DDD ${ddd}`);
      const timezone = tz.value;

      // Score from the latest attempt with answers, through the real engine.
      const scored = [...lead.attempts].reverse().find((a) => a.answers);
      let score: number | null = null;
      if (scored?.answers) {
        const answers: ScoringAnswer[] = Object.entries(scored.answers).map(([key, a]) => ({ criterionKey: key, value: a.value }));
        const result = scoreLead({ criteria: scoringCriteria, answers, settings: SETTINGS });
        if (result.ok) score = result.value.score;
      }

      await tx
        .insert(leads)
        .values({
          id: leadId(lead.n),
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          ddd,
          timezone,
          preferredCallLanguage: lead.callLanguage,
          status: lead.status,
          score,
          qualificationReason: lead.reason,
          icebreaker: lead.icebreaker,
          source: lead.source,
          attemptCount: lead.attempts.length,
          nextCallAt: lead.nextCallAt ? new Date(lead.nextCallAt) : null,
          optOutAt: lead.optOutAt ? new Date(lead.optOutAt) : null,
          createdAt,
          updatedAt: createdAt,
        })
        .onConflictDoUpdate({
          target: leads.id,
          set: {
            name: lead.name,
            email: lead.email,
            phone: lead.phone,
            status: lead.status,
            score,
            qualificationReason: lead.reason,
            icebreaker: lead.icebreaker,
            attemptCount: lead.attempts.length,
            nextCallAt: lead.nextCallAt ? new Date(lead.nextCallAt) : null,
            optOutAt: lead.optOutAt ? new Date(lead.optOutAt) : null,
            updatedAt: new Date(),
          },
        });

      for (const attempt of lead.attempts) {
        const attemptCreated = new Date(attempt.scheduledAt);
        const id = attemptId(lead.n, attempt.n);
        await tx
          .insert(callAttempts)
          .values({
            id,
            leadId: leadId(lead.n),
            attemptNumber: attempt.n,
            scheduledAt: attemptCreated,
            startedAt: attempt.startedAt ? new Date(attempt.startedAt) : null,
            endedAt: attempt.endedAt ? new Date(attempt.endedAt) : null,
            outcome: attempt.outcome,
            endedReason: attempt.endedReason,
            scoringStatus: attempt.answers ? "done" : attempt.endedAt ? "done" : "pending",
            transcript: attempt.transcript,
            transcriptExpiresAt: attempt.transcript ? addMonths(attemptCreated, TRANSCRIPT_RETENTION_MONTHS) : null,
            createdAt: attemptCreated,
            updatedAt: attemptCreated,
          })
          .onConflictDoUpdate({
            target: callAttempts.id,
            set: {
              outcome: attempt.outcome,
              endedReason: attempt.endedReason,
              transcript: attempt.transcript,
              startedAt: attempt.startedAt ? new Date(attempt.startedAt) : null,
              endedAt: attempt.endedAt ? new Date(attempt.endedAt) : null,
              updatedAt: new Date(),
            },
          });

        if (attempt.answers) {
          for (const [key, a] of Object.entries(attempt.answers)) {
            const criterion = criterionByKey.get(key);
            if (!criterion) throw new Error(`Seed answer references unknown criterion ${key}`);
            const passed = evaluateAnswer(
              { key, type: criterion.type, expectedValue: criterion.expectedValue, weight: criterion.weight, blocking: criterion.blocking, active: criterion.active },
              a.value,
            );
            await tx
              .insert(qualificationAnswers)
              .values({
                callAttemptId: id,
                criteriaId: criterion.id,
                extractedValue: a.extracted,
                normalizedValue: a.value,
                confidence: "0.900",
                evidence: a.evidence ?? null,
                passed: passed.ok ? passed.value : null,
              })
              .onConflictDoUpdate({
                target: [qualificationAnswers.callAttemptId, qualificationAnswers.criteriaId],
                set: {
                  extractedValue: a.extracted,
                  normalizedValue: a.value,
                  evidence: a.evidence ?? null,
                  passed: passed.ok ? passed.value : null,
                  updatedAt: new Date(),
                },
              });
          }
        }
      }
    }

    // Audit history
    for (const entry of AUDIT) {
      await tx
        .insert(criteriaAuditLog)
        .values({
          id: entry.id,
          criteriaId: entry.criterion === null ? null : criterionId(entry.criterion),
          changedBy: empId(employeeId(entry.employee)),
          field: entry.field,
          oldValue: entry.oldValue,
          newValue: entry.newValue,
          changedAt: new Date(entry.changedAt),
        })
        .onConflictDoNothing({ target: criteriaAuditLog.id });
    }
  });

  const [{ n }] = (await db.execute(sql`select count(*)::int as n from leads`)) as unknown as [{ n: number }];
  console.log(`Seed complete: ${n} leads, ${CRITERIA.length} criteria, ${EMPLOYEES.length} employees, ${AUDIT.length} audit entries.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = directDatabaseUrl();
  if (!url) {
    console.error("No database URL configured.");
    process.exit(1);
  }
  const { db, close } = createStandaloneDb(url);
  seed(db)
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => close());
}
