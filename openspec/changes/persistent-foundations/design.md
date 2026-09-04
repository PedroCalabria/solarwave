## Context

`apps/web` is a complete Next.js 16 UI over demo constants. The intake route keeps dedup and rate-limit state in process memory; the portal has no auth; `packages/` is empty. The functional spec (section 8) gives a database schema, but the demo data and UI already encode behaviour the spec does not: blocking criteria, a 70-point hand-off threshold, criterion question text, callback requests, and "answered but incomplete" calls. This change persists everything, extends the schema to close that drift, and extracts all deterministic rules into a pure package so later changes (scoring worker, voice bridge, lifecycle workflow) call tested code instead of re-deriving it.

Constraints: demo project on the Vercel Hobby plan and Supabase free tier; TypeScript/pnpm monorepo; Next.js 16 APIs differ from training data (read `apps/web/node_modules/next/dist/docs/`); everything in English; no LLM calls in this change.

## Goals / Non-Goals

**Goals:**
- One source of truth in Postgres for leads, attempts, answers, criteria, settings, audit, employees.
- A pure, unit-tested `packages/core` that every later change reuses: phone, timezone, window, retry, state machine, scoring, enough-information rule.
- Intake that is safe against duplicates and abuse without in-memory state.
- Portal reading and writing the database behind real authentication with roles.
- Schema decisions recorded so later changes do not reopen them.

**Non-Goals:**
- Dispatching calls, starting workflows, LLM extraction or prose, transcript purge, realtime updates, non-Brazilian numbers, password reset or invitations.

## Decisions

### D1. Drizzle ORM with the `postgres` (postgres-js) driver, Supabase transaction pooler
Drizzle keeps the schema in TypeScript, generates SQL migrations we can read, and works against any Postgres, so the domain stays vendor-neutral if Supabase is swapped. Prisma was considered; it is heavier at cold start on Functions and hides SQL. The Supabase transaction pooler (port 6543) requires `prepare: false` on postgres-js. The client is created lazily through a `getDb()` function so `next build` does not crash before env vars exist; no `Proxy` wrappers (they break Auth libraries that inspect the object).

### D2. Schema: spec section 8 extended, with enums as Postgres enums
Extensions and their reasons:
- `qualification_criteria`: `key` (stable slug used in prompts and extraction schemas), `label`, `question_pt`, `question_en`, `type` enum (`boolean|numeric|enum|free_text`), `expected_value` (text, parsed per type, see D5), `weight` (integer 0–100), `blocking`, `active`, `sort_order`, `updated_by`, timestamps. The UI's `name`/`question` become `label`/`question_*`.
- `settings`: single-row style key/value table with `handoff_threshold` (default 70) and `min_answered_weight_share` (default 0.6). Changes are audited in `criteria_audit_log` with a null `criteria_id` and `field = setting:<key>`.
- `leads`: adds `next_call_at`, `attempt_count`, `opt_out_at`, `workflow_run_id`, `source`. `phone` stores E.164 and carries the unique index. `ddd` and `timezone` are derived at insert.
- `call_attempts`: adds `twilio_call_sid` (unique, nullable), `scoring_status` enum (`pending|running|done|failed`), `ended_reason` text. `outcome` enum: `answered_complete|answered_incomplete|no_answer|voicemail|busy|failed|abusive|minor_answered|opt_out`. `transcript` is `jsonb` (array of `{who, text, at}`) rather than plain text so the portal can render turns; `transcript_expires_at` kept per spec.
- `qualification_answers`: adds `normalized_value` jsonb, `confidence` numeric, `evidence` text, `passed` boolean. Unique on `(call_attempt_id, criteria_id)` so re-scoring upserts.
- `guardrail_violations`: `id`, `call_attempt_id`, `guardrail` (text key from spec section 6), `severity`, `evidence`, `created_at`. Empty in this change; created now so the schema is settled.
- `employees`: `id` = Supabase Auth user id (uuid), `name`, `email`, `role` enum (`agent|admin`), `active`.
- `intake_rate_limits`: `ip_hash`, `window_start`, `count`. Cheap alternative to Redis for a demo.

### D3. Open question settled: no `scoring` lead status
The lead stays in `calling` from dispatch until the scoring worker writes the final status. The sub-state lives on the attempt as `scoring_status`. Rationale: the spec lifecycle (section 7) stays intact, the UI `STATUS` map is unchanged, scoring takes seconds, and the portal can already display "call ended, scoring" from the attempt row. Adding a lead-level status would touch every filter and badge for a state that lasts seconds.

### D4. State machine lives in `packages/core`, persistence enforces it
`transition(current, event) -> next | Error` is a pure function with an explicit table:

| From | Event | To |
|---|---|---|
| new | dispatch | calling |
| calling | no_answer / busy / voicemail / failed / answered_incomplete / minor_answered, attempts < 3 | waiting_retry |
| calling | same outcomes, attempts = 3 | no_answer_final |
| waiting_retry | dispatch | calling |
| calling | answered_complete, score >= threshold, no blocking failed | qualified |
| calling | answered_complete, otherwise | disqualified |
| calling | abusive | disqualified |
| any non-terminal | opt_out | opt_out |
| qualified / disqualified / no_answer_final / opt_out | anything | rejected (terminal) |

`opt_out` is terminal and cannot be left. The database layer applies transitions inside a transaction with `SELECT ... FOR UPDATE` on the lead row, so later concurrent writers (Twilio callbacks, workflow steps) cannot race.

### D5. Scoring engine semantics
- `expected_value` grammar per type: boolean `true|false`; numeric a comparator expression (`>= 300`, `< 2000`, `300..1500`); enum a pipe-separated list of accepted values (`ceramic|metal`); free_text has no rule and passes when answered (informational weight).
- `score = round(100 * sum(weight of passed active criteria) / sum(weight of active criteria))`. Normalising keeps the threshold meaningful when weights do not sum to 100. Unanswered criteria contribute 0.
- A failed blocking criterion forces `disqualified` regardless of score; the score is still computed and stored for the dashboard.
- `enoughInformation = every active blocking criterion answered AND answeredWeightShare >= min_answered_weight_share`.
- The engine is pure: input is `{criteria[], answers[], settings}`, output is `{score, passedKeys, failedBlocking[], enoughInformation, decision}`. Re-scoring after criteria changes is calling it again.

### D6. Timezone and window
A static DDD to IANA map (`America/Sao_Paulo` default; `America/Cuiaba` 65/66, `America/Campo_Grande` 67, `America/Manaus` 92/97, `America/Boa_Vista` 95, `America/Porto_Velho` 69, `America/Rio_Branco` 68, `America/Noronha` has no own DDD and is ignored). Window arithmetic uses `Intl.DateTimeFormat` on the IANA zone rather than fixed offsets, so a future DST change needs no code change. `nextAllowedTime(candidate, tz)` returns `candidate` if inside 08:00–22:00 local, otherwise the next 08:00 local. Retry: `attempt 1 -> +15 min`, `attempt 2 -> +2 days`, both measured from the actual end of the previous attempt, then pushed through `nextAllowedTime`. The function accepts an optional `requestedAt` override so the lifecycle change can honour callback requests without touching core.

### D7. Intake write path
One transaction: normalise phone (libphonenumber-js, default region BR, reject non-BR numbers); `INSERT ... ON CONFLICT (phone) DO NOTHING RETURNING id`; if no row returned, load the existing lead and return `status: "existing"` without touching it (an `opt_out` lead is therefore never re-scheduled, satisfying spec section 6 opt-out priority). On insert, compute `ddd`, `timezone`, `next_call_at = nextAllowedTime(now, tz)` and `status = new`. CAPTCHA: verify the Turnstile token server-side before any DB work; Cloudflare's published test keys make local and CI runs pass deterministically. Rate limit: upsert into `intake_rate_limits` keyed by a salted hash of the IP per 60-second window, limit 5.

### D8. Authentication with Supabase Auth via `@supabase/ssr`
Email + password for the demo. A `proxy.ts` (Next 16 name for middleware) refreshes the session cookie and redirects unauthenticated requests under `/portal` (except `/portal/login`) to the login page. Server Components read the user and join `employees` for the role; Server Actions re-check the role before mutating. Roles live in the `employees` table rather than JWT claims to keep the demo simple. A seed script creates one admin and one agent through the service-role key.

### D9. Portal data access and mutations
Pages are Server Components calling `packages/db` query functions directly; no internal REST layer. Mutations (criteria, settings) are Server Actions that run the write and the audit rows in a single transaction. `apps/web/src/lib/leads.ts` keeps presentation helpers (`STATUS`, `scoreColor`) and types derived from Drizzle's inferred types; the demo arrays move to `packages/db/seed`. Demo leads with +1 numbers are re-pointed to +55 fixtures in the seed to respect the Brazil-only scope; their bill/roof/owner/timeline fields become `qualification_answers` rows linked to the seeded criteria.

## Risks / Trade-offs

- [Supabase free tier pauses inactive projects] → Keep-alive cron arrives in the lifecycle change; until then, document the manual "restore" step in the README.
- [Pooler and prepared statements] → `prepare: false`; integration tests run against a local Postgres in Docker or a Supabase branch.
- [Next.js 16 API drift (proxy.ts, async params, cookies)] → Read bundled docs before writing; typecheck in CI.
- [Turnstile blocks local end-to-end runs] → Use Cloudflare test site/secret keys in `.env.local`.
- [Unique index race on simultaneous submits] → `ON CONFLICT DO NOTHING` is the only dedup path; no read-then-write.
- [Normalising score to active weight hides "few criteria, high score"] → Dashboard also shows answered count; threshold is configurable.
- [Seed drift from UI expectations] → Seed asserts the same ids the UI links to today so screenshots and demos keep working.
- [Hobby plan limits] → None bite here: Functions are short, no cron or workflow used yet. Recorded so later changes remember that Hobby cron is daily-only and Functions cap at 300 s.

## Migration Plan

1. `vercel integration add supabase`, then `vercel env pull .env.local`.
2. `pnpm --filter @solarwave/db migrate` (Drizzle migrations) and `pnpm --filter @solarwave/db seed`.
3. Create Turnstile site; set keys in Vercel and `.env.local`.
4. Deploy. The old in-memory intake and demo constants are deleted in the same release; rollback is `git revert` plus redeploy, the database can stay in place.

## Open Questions

- Should the seed keep the two English-language demo leads (now on +55 numbers) to show the EN call path in the portal? Default: yes.
- Whether `intake_rate_limits` is enough or Vercel Firewall rate-limit rules should replace it before the demo. Default: table now, revisit in operations change.
