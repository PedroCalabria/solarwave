## Why

Every screen of SolarWave exists, but nothing behind them is real: leads, criteria and audit entries are constants in `apps/web/src/lib/leads.ts`, the intake API dedups and rate-limits in process memory, and any non-empty email opens the portal. The automation that is the point of the product (scheduled AI calls, LLM-assisted scoring, the lead lifecycle) cannot be built until there is a database to persist state and a pure, testable domain core that later changes can call. This change lays that foundation and settles the schema drift between the spec (section 8), the demo data and the UI.

## What Changes

- **New `packages/db`**: Drizzle ORM schema and migrations for Supabase Postgres (provisioned through the Vercel Marketplace). Implements spec section 8 extended with: criteria `blocking`, `question_pt`, `question_en`, typed `expected_value`; a `settings` table (hand-off threshold, minimum answered-weight share); leads `next_call_at`, `attempt_count`, `opt_out_at`, `workflow_run_id`; call_attempts `twilio_call_sid`, `scoring_status` and the extended `outcome` enum; qualification_answers `normalized_value`, `confidence`, `evidence`, `passed`; a `guardrail_violations` table; employees linked to Supabase Auth users. A seed script loads the current demo leads, criteria and audit entries so the portal stays populated.
- **New `packages/core`**: pure TypeScript domain logic with Vitest coverage and zero I/O: phone normalisation (libphonenumber-js, +55 default), DDD to IANA timezone lookup, 08:00–22:00 call-window computation in the lead's timezone, retry schedule (15 min after attempt 1, 2 days after attempt 2, pushed into the window), the lead status state machine (spec section 7), the deterministic scoring engine (blocking, weights, threshold, per-type `expected_value` evaluation) and the "enough information" rule (spec section 4.5).
- **Intake API on the database** (spec sections 3 and 4.1–4.2): `POST /api/leads` verifies a Cloudflare Turnstile token, applies a database-backed per-IP rate limit, normalises the phone, inserts atomically against the unique phone index, computes `next_call_at` for attempt 1, and never re-schedules a phone whose lead is `opt_out`. **BREAKING** for the current response shape: the response now returns the persisted lead id.
- **Portal on the database** (spec section 5): leads list, lead detail (attempts, answers, transcript), criteria and audit pages read from Postgres. Lead detail renders qualification answers as a list driven by criteria instead of the fixed bill/roof/owner/timeline fields.
- **Criteria management persisted**: create, edit, toggle and delete criteria with the new fields; every field change writes a `criteria_audit_log` row (who, what, when, old vs new). The hand-off threshold becomes a persisted setting with the same audit treatment. The criteria page shows a question budget warning when more than six criteria are active.
- **Employee authentication**: Supabase Auth (email + password for the demo) protects every `/portal` route; roles `agent` and `admin` come from the `employees` table. Only `admin` can change criteria and settings.
- **Removed**: the in-memory `seenPhones` set and rate-limit map in the intake route; portal components no longer import demo constants.

Deterministic vs LLM: everything in this change is deterministic. No LLM, Twilio, Gemini or Workflow call is made. `next_call_at` is recorded but the call itself is not dispatched (that is the lifecycle change).

## Capabilities

### New Capabilities
- `lead-intake`: public form submission API — validation, phone normalisation, CAPTCHA, rate limit, atomic dedup, opt-out suppression, first-attempt scheduling.
- `call-scheduling`: deterministic rules for DDD timezone resolution, the 08:00–22:00 window and the retry schedule.
- `lead-lifecycle`: lead status state machine, call-attempt outcomes and the "enough information" rule.
- `qualification-scoring`: deterministic scoring engine — per-type `expected_value` evaluation, weights, blocking criteria, hand-off threshold.
- `criteria-management`: criteria CRUD, hand-off threshold setting, audit log, question budget.
- `employee-auth`: Supabase Auth login, session protection of `/portal`, `agent`/`admin` roles.
- `lead-portal`: leads dashboard and lead detail backed by the database.

### Modified Capabilities
None. `openspec/specs/` is empty; these are the first specs.

## Non-goals

- No LLM calls (scoring extraction, reason/icebreaker, guardrail judge, question linter come in `scoring-worker` and `conversation-agent-text`).
- No Twilio or Gemini integration, no audio, no transcripts produced (`voice-bridge`).
- No Vercel Workflow start, no dispatch of calls, no retry execution, no transcript purge or keep-alive cron (`lifecycle-and-operations`). Intake only records `next_call_at`.
- No realtime dashboard updates; pages read on request.
- No support for non-Brazilian numbers; phase 1 is +55 only.
- No password reset, invitation flow or SSO; a seeded admin and manual user creation are enough for the demo.

## Impact

- **New workspaces**: `packages/db`, `packages/core`. Root `pnpm-workspace.yaml` already includes `packages/*`.
- **New dependencies**: `drizzle-orm`, `drizzle-kit`, `postgres`, `@supabase/supabase-js`, `@supabase/ssr`, `libphonenumber-js`, `vitest`, `zod`, `dotenv-cli`.
- **External services**: Supabase project via `vercel integration add supabase`; Cloudflare Turnstile site (test keys locally).
- **Affected code**: `apps/web/src/app/api/leads/route.ts`, all `apps/web/src/app/portal/**` pages, `LeadsDashboard.tsx`, `CriteriaManager.tsx`, `LeadForm.tsx` (Turnstile widget), `apps/web/src/lib/leads.ts` (becomes types + presentation helpers only; data moves to the seed), new `proxy.ts` for auth.
- **Spec sections touched**: 3, 4.1, 4.2, 4.5 (rule definition only), 5, 6 (opt-out suppression), 7, 8.
- **Environment**: `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (seed only), `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
