import { ATTEMPT_OUTCOMES, CRITERION_TYPES, LEAD_STATUSES } from "@solarwave/core";
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ enums */

export const leadStatusEnum = pgEnum("lead_status", LEAD_STATUSES);
export const attemptOutcomeEnum = pgEnum("attempt_outcome", ATTEMPT_OUTCOMES);
export const scoringStatusEnum = pgEnum("scoring_status", ["pending", "running", "done", "failed"]);
export const criterionTypeEnum = pgEnum("criterion_type", CRITERION_TYPES);
export const employeeRoleEnum = pgEnum("employee_role", ["agent", "admin"]);
export const callLanguageEnum = pgEnum("call_language", ["pt", "en"]);

export type ScoringStatus = (typeof scoringStatusEnum.enumValues)[number];
export type EmployeeRole = (typeof employeeRoleEnum.enumValues)[number];
export type CallLanguage = (typeof callLanguageEnum.enumValues)[number];

/** A transcript turn as stored in `call_attempts.transcript`. */
export type TranscriptTurn = { who: "ai" | "lead"; text: string; at?: string };

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/* -------------------------------------------------------------- employees */

/** `id` is the Supabase Auth user id (design D8). */
export const employees = pgTable("employees", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: employeeRoleEnum("role").notNull().default("agent"),
  active: boolean("active").notNull().default(true),
  ...timestamps,
});

/* ------------------------------------------------------------------ leads */

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    /** E.164. Deduplication key (spec section 8). */
    phone: text("phone").notNull(),
    ddd: varchar("ddd", { length: 2 }).notNull(),
    timezone: text("timezone").notNull(),
    preferredCallLanguage: callLanguageEnum("preferred_call_language").notNull().default("pt"),
    status: leadStatusEnum("status").notNull().default("new"),
    score: integer("score"),
    qualificationReason: text("qualification_reason"),
    icebreaker: text("icebreaker"),
    source: text("source"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextCallAt: timestamp("next_call_at", { withTimezone: true }),
    optOutAt: timestamp("opt_out_at", { withTimezone: true }),
    workflowRunId: text("workflow_run_id"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("leads_phone_unique").on(t.phone),
    index("leads_status_idx").on(t.status),
    index("leads_next_call_at_idx").on(t.nextCallAt),
    index("leads_created_at_idx").on(t.createdAt),
  ],
);

/* ---------------------------------------------------------- call_attempts */

export const callAttempts = pgTable(
  "call_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    outcome: attemptOutcomeEnum("outcome"),
    endedReason: text("ended_reason"),
    twilioCallSid: text("twilio_call_sid"),
    scoringStatus: scoringStatusEnum("scoring_status").notNull().default("pending"),
    /** When scoring last completed. Null means never scored (design D9). */
    scoredAt: timestamp("scored_at", { withTimezone: true }),
    transcript: jsonb("transcript").$type<TranscriptTurn[]>(),
    /** created_at + 12 months (spec section 10). */
    transcriptExpiresAt: timestamp("transcript_expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("call_attempts_lead_attempt_unique").on(t.leadId, t.attemptNumber),
    uniqueIndex("call_attempts_twilio_sid_unique").on(t.twilioCallSid),
    index("call_attempts_transcript_expires_idx").on(t.transcriptExpiresAt),
  ],
);

/* ------------------------------------------------- qualification_criteria */

export const qualificationCriteria = pgTable(
  "qualification_criteria",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Stable slug used in prompts and extraction schemas. */
    key: text("key").notNull(),
    label: text("label").notNull(),
    questionPt: text("question_pt").notNull(),
    questionEn: text("question_en").notNull(),
    type: criterionTypeEnum("type").notNull(),
    /**
     * The vocabulary an enum criterion can be answered with, pipe-separated.
     * Distinct from `expectedValue`, which is the subset that passes: a lead may
     * legitimately answer with a value that fails (design D5). Null otherwise.
     */
    options: text("options"),
    /** Rule in the per-type grammar. Null for free_text. */
    expectedValue: text("expected_value"),
    weight: integer("weight").notNull(),
    blocking: boolean("blocking").notNull().default(false),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Soft delete keeps answers and audit rows linked (criteria-management spec). */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    updatedBy: uuid("updated_by").references(() => employees.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("qualification_criteria_key_unique").on(t.key),
    index("qualification_criteria_active_idx").on(t.active),
  ],
);

/* -------------------------------------------------- qualification_answers */

export const qualificationAnswers = pgTable(
  "qualification_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    callAttemptId: uuid("call_attempt_id")
      .notNull()
      .references(() => callAttempts.id, { onDelete: "cascade" }),
    criteriaId: uuid("criteria_id")
      .notNull()
      .references(() => qualificationCriteria.id, { onDelete: "restrict" }),
    /** What the lead said, as extracted. */
    extractedValue: text("extracted_value"),
    /** Typed value the engine evaluates (boolean | number | string | null). */
    normalizedValue: jsonb("normalized_value"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    evidence: text("evidence"),
    passed: boolean("passed"),
    ...timestamps,
  },
  (t) => [uniqueIndex("qualification_answers_attempt_criteria_unique").on(t.callAttemptId, t.criteriaId)],
);

/* ----------------------------------------------------- criteria_audit_log */

export const criteriaAuditLog = pgTable(
  "criteria_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for settings changes (field = "setting:<key>"). */
    criteriaId: uuid("criteria_id").references(() => qualificationCriteria.id, { onDelete: "set null" }),
    changedBy: uuid("changed_by")
      .notNull()
      .references(() => employees.id),
    field: text("field").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("criteria_audit_log_changed_at_idx").on(t.changedAt)],
);

/* --------------------------------------------------------------- settings */

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by").references(() => employees.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const SETTING_KEYS = {
  handoffThreshold: "handoff_threshold",
  minAnsweredWeightShare: "min_answered_weight_share",
} as const;

/* --------------------------------------------------- guardrail_violations */

export const guardrailViolations = pgTable(
  "guardrail_violations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    callAttemptId: uuid("call_attempt_id")
      .notNull()
      .references(() => callAttempts.id, { onDelete: "cascade" }),
    /** Key of the spec section 6 guardrail, e.g. "no_prices". */
    guardrail: text("guardrail").notNull(),
    severity: text("severity").notNull().default("medium"),
    evidence: text("evidence"),
    /** Null until an employee reviews it. High severity blocks dispatch until then (design D8b). */
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by").references(() => employees.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("guardrail_violations_attempt_idx").on(t.callAttemptId)],
);

/* ------------------------------------------------------ intake_rate_limits */

export const intakeRateLimits = pgTable(
  "intake_rate_limits",
  {
    ipHash: text("ip_hash").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.ipHash, t.windowStart] })],
);

/* -------------------------------------------------------------- relations */

export const leadsRelations = relations(leads, ({ many }) => ({
  attempts: many(callAttempts),
}));

export const callAttemptsRelations = relations(callAttempts, ({ one, many }) => ({
  lead: one(leads, { fields: [callAttempts.leadId], references: [leads.id] }),
  answers: many(qualificationAnswers),
  violations: many(guardrailViolations),
}));

export const qualificationCriteriaRelations = relations(qualificationCriteria, ({ many }) => ({
  answers: many(qualificationAnswers),
  auditEntries: many(criteriaAuditLog),
}));

export const qualificationAnswersRelations = relations(qualificationAnswers, ({ one }) => ({
  attempt: one(callAttempts, { fields: [qualificationAnswers.callAttemptId], references: [callAttempts.id] }),
  criterion: one(qualificationCriteria, {
    fields: [qualificationAnswers.criteriaId],
    references: [qualificationCriteria.id],
  }),
}));

export const criteriaAuditLogRelations = relations(criteriaAuditLog, ({ one }) => ({
  criterion: one(qualificationCriteria, {
    fields: [criteriaAuditLog.criteriaId],
    references: [qualificationCriteria.id],
  }),
  employee: one(employees, { fields: [criteriaAuditLog.changedBy], references: [employees.id] }),
}));

export const guardrailViolationsRelations = relations(guardrailViolations, ({ one }) => ({
  attempt: one(callAttempts, { fields: [guardrailViolations.callAttemptId], references: [callAttempts.id] }),
}));

/* ----------------------------------------------------------------- types */

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type CallAttempt = typeof callAttempts.$inferSelect;
export type NewCallAttempt = typeof callAttempts.$inferInsert;
export type Criterion = typeof qualificationCriteria.$inferSelect;
export type NewCriterion = typeof qualificationCriteria.$inferInsert;
export type QualificationAnswer = typeof qualificationAnswers.$inferSelect;
export type NewQualificationAnswer = typeof qualificationAnswers.$inferInsert;
export type AuditEntry = typeof criteriaAuditLog.$inferSelect;
export type Employee = typeof employees.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type GuardrailViolation = typeof guardrailViolations.$inferSelect;

/** Handy for `WHERE deleted_at IS NULL`. */
export const notDeleted = sql`${qualificationCriteria.deletedAt} is null`;
