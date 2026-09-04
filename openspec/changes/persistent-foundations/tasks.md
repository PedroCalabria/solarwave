## 1. Workspace and tooling

- [x] 1.1 Create `packages/core` and `packages/db` workspaces (`@solarwave/core`, `@solarwave/db`) with `package.json`, `tsconfig.json` extending a shared base, and `exports` maps; add `test`, `typecheck`, `db:generate`, `db:migrate`, `db:seed` scripts to the root `package.json`
- [x] 1.2 Add Vitest to `packages/core` and `packages/db` (unit config, plus an integration config gated on `DATABASE_URL`); add `pnpm test` at the root running both
- [x] 1.3 Add `dotenv-cli` and document in `README.md` how `drizzle-kit`, `tsx` scripts and tests load `.env.local`
- [x] 1.4 Commit `.claude/` and `openspec/` (currently untracked) so the decision log travels with the repo

## 2. packages/core — phone and timezone

- [x] 2.1 Implement `normalizePhone(input)` with libphonenumber-js (default region BR, reject non-BR, return E.164 and DDD); unit tests for national format, `+55` format, leading zeros, landlines, US number rejection
- [x] 2.2 Implement `dddToTimezone(ddd)` with the static map from design D6 and an error for unknown DDDs; unit tests covering every mapped zone and an invalid code

## 3. packages/core — call window and retry

- [x] 3.1 Implement `isWithinCallWindow(instant, tz)` and `nextAllowedTime(instant, tz)` using `Intl.DateTimeFormat` on IANA zones; unit tests for inside, before 08:00, exactly 22:00, after 22:00, and the two-zone same-instant scenario
- [x] 3.2 Implement `scheduleRetry({ attemptNumber, endedAt, tz, requestedAt? })` returning the next instant or `null` after attempt 3; unit tests for +15 min, +2 days pushed into window, measurement from actual end, requested time inside and outside the window, no fourth attempt

## 4. packages/core — lifecycle and scoring

- [x] 4.1 Define `LeadStatus`, `AttemptOutcome`, `LeadEvent` types and implement `transition(status, event, ctx)` with the table from design D4; unit tests for every row, every terminal rejection and opt-out from each non-terminal status
- [x] 4.2 Implement `parseExpectedValue(type, raw)` with the grammar from design D5 (boolean, comparators, ranges, enum lists, free_text) returning a typed rule or a validation error; unit tests per branch including malformed input
- [x] 4.3 Implement `evaluateAnswer(criterion, answer)` and `scoreLead({ criteria, answers, settings })` returning `{ score, passedKeys, failedBlocking, answeredWeightShare, enoughInformation, decision }`; unit tests for normalisation, inactive criteria, unanswered criteria, blocking override, threshold at/below, threshold re-run, determinism
- [x] 4.4 Implement `hasEnoughInformation(criteria, answers, minShare)` (used by 4.3) with the three spec scenarios as tests
- [x] 4.5 Export a `packages/core` index and write a short `README.md` stating the package has no I/O and how later changes should call it

## 5. packages/db — schema and migrations

- [x] 5.1 Write the Drizzle schema for enums (`lead_status`, `attempt_outcome`, `scoring_status`, `criterion_type`, `employee_role`) and tables `leads`, `call_attempts`, `qualification_criteria`, `qualification_answers`, `criteria_audit_log`, `employees`, `settings`, `guardrail_violations`, `intake_rate_limits` per design D2, including the unique index on `leads.phone`, unique `(call_attempt_id, criteria_id)` and unique nullable `twilio_call_sid`
- [x] 5.2 Implement the lazy `getDb()` client on postgres-js with `prepare: false` (no Proxy), and generate the initial migration with `drizzle-kit`
- [x] 5.3 Write query modules: `leads` (list with filter/search/counts, byId with attempts, answers and latest transcript, KPIs), `criteria` (list active ordered, CRUD), `settings` (get/set), `audit` (list, append), `employees` (byAuthUserId)
- [x] 5.4 Implement `applyLeadTransition(leadId, event, ctx)` running `transition()` from core inside a transaction with `SELECT ... FOR UPDATE`; integration test for the concurrent opt-out vs no_answer scenario
- [x] 5.5 Implement `createLeadIfNew(input)` using `INSERT ... ON CONFLICT (phone) DO NOTHING RETURNING`, computing `ddd`, `timezone`, `next_call_at` via core; integration tests for created, existing, opt_out untouched, and two concurrent inserts
- [x] 5.6 Implement `consumeIntakeRateLimit(ipHash, now)` upserting into `intake_rate_limits` (5 per 60 s window); integration test for the sixth request

## 6. packages/db — seed

- [x] 6.1 Port the demo criteria from `apps/web/src/lib/leads.ts` into seed data with `key`, `question_pt`, `question_en`, `expected_value`, `blocking` (homeowner blocking) and keep the credit pre-check inactive; seed `settings` with threshold 70 and share 0.6
- [x] 6.2 Port the nine demo leads keeping their ids, statuses, scores, reasons, icebreakers, attempts (mapped to the new outcome enum) and transcripts as jsonb turns; re-point the two `+1` leads to `+55` fixtures and derive their timezone from the DDD
- [x] 6.3 Convert the demo bill/roof/owner/timeline fields into `qualification_answers` rows linked to the seeded criteria with `passed` computed by the core engine, and port the six demo audit entries
- [x] 6.4 Seed one `admin` and one `agent` Supabase Auth user with the service-role key and matching `employees` rows; make the seed idempotent

## 7. Supabase provisioning and authentication

- [ ] 7.1 Provision Supabase through `vercel integration add supabase`, pull env vars, run migrations and seed against the real project; record the manual "restore paused project" step in `README.md`
- [x] 7.2 Add `@supabase/ssr` server and browser client helpers in `apps/web/src/lib/supabase/` reading the public env vars
- [x] 7.3 Add `apps/web/src/proxy.ts` that refreshes the session and redirects unauthenticated `/portal/*` (except `/portal/login`) to the login page; verify against the Next 16 docs in `node_modules/next/dist/docs/`
- [x] 7.4 Implement `getCurrentEmployee()` (session user joined with `employees`, denies inactive or missing rows) and `requireAdmin()` helpers for Server Components and Server Actions
- [x] 7.5 Wire `/portal/login` to Supabase email/password sign-in with error display, redirect to `/portal/leads`, and a sign-out action in `PortalSidebar`; show name and role in the sidebar

## 8. Intake API

- [x] 8.1 Add the Turnstile widget to `LeadForm.tsx` (site key from env, test keys locally) and send `turnstileToken` in the payload; add bilingual copy for the CAPTCHA error
- [x] 8.2 Rewrite `POST /api/leads`: validate with zod, verify Turnstile server-side (400 missing, 403 invalid), consume the DB rate limit (429), call `createLeadIfNew`, return `201 created` with lead id or `200 existing`; delete the in-memory `seenPhones` and `hits` state
- [x] 8.3 Reject non-Brazilian numbers with a `phone` field error and update `LeadForm` client validation and copy to say Brazilian numbers only
- [x] 8.4 Update the confirmation page to read the created lead by id from the redirect query instead of sessionStorage, keeping the sessionStorage fallback for the demo path
- [x] 8.5 Route tests (Vitest with mocked Turnstile fetch against the integration database) for created, existing, opt_out untouched, rate limit, CAPTCHA failures, invalid language fallback

## 9. Portal on the database

- [x] 9.1 Refactor `apps/web/src/lib/leads.ts` to presentation helpers and types inferred from Drizzle; remove `LEADS`, `CRITERIA`, `AUDIT`, `KPIS`, `LOGIN_STATS` arrays
- [x] 9.2 Make `/portal/leads` a Server Component that loads leads, counts and KPIs from `@solarwave/db`; pass data into `LeadsDashboard` and move filter/search to URL search params; keep the loading and empty states
- [x] 9.3 Rewrite `/portal/leads/[id]` to load the lead, attempts, latest answers and transcript from the database; render answers as a criteria-driven list with pass/fail marks and show `next_call_at` for leads without attempts
- [x] 9.4 Rewrite `CriteriaManager` as a Server Component plus Server Actions (`createCriterion`, `updateCriterion`, `toggleCriterion`, `deleteCriterion`, `updateSetting`) guarded by `requireAdmin()`, writing audit rows in the same transaction; add fields for key, question_pt, question_en, expected_value, blocking; read-only mode for agents
- [x] 9.5 Add the hand-off threshold and minimum answered share controls to the criteria page and the question budget warning when more than six criteria are active
- [x] 9.6 Make `/portal/audit` read `criteria_audit_log` joined with employees and criteria, newest first, including setting changes
- [x] 9.7 Grep for remaining imports of the removed demo constants under `apps/web/src/app` and `apps/web/src/components` and remove them; run `pnpm lint` and `pnpm typecheck`

## 10. Verification and documentation

- [x] 10.1 Run the full unit and integration suites and `pnpm build`; fix regressions
- [ ] 10.2 Manually exercise: submit a lead in PT and EN, resubmit the same phone, log in as agent and admin, edit a criterion and confirm the audit row, change the threshold
- [x] 10.3 Update `README.md` "State of the build" and the route table; document env vars and the local setup sequence (integration add, env pull, migrate, seed)
