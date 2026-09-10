## 1. Spikes — settle the runtime unknowns before anything is built

Section 1 answers questions whose answers change the shape of the change.
Nothing below section 2 should start until they have. Change 4 learned this the
expensive way: `next dev` does not perform a WebSocket upgrade, and discovering
that late would have reorganised a finished implementation.

**SETTLED 2026-09-06. `workflow@4.8.5`. The headline: this is the opposite of
change 4's WebSocket finding — the local development story has no constraint at
all, and design D11's rung 1 applies, so both retries are durable sleeps.**

- [x] 1.1 Read `node_modules/workflow/docs/getting-started/next.mdx` and
  `node_modules/workflow/docs/foundations/workflows-and-steps.mdx` before writing
  anything. The package is `workflow`, not `@vercel/workflow`, and the decision
  log's note predates the SDK's current shape. Record the actual import surface
  and the Next.js wiring in the log

MEASURED. The import surface: `sleep`, `createHook`, `FatalError`,
`RetryableError` from `workflow`; `start`, `getRun`, `resumeHook` from
`workflow/api`; `withWorkflow` from `workflow/next`. Wiring is one line —
`export default withWorkflow(nextConfig)` in `apps/web/next.config.ts` — which
is what enables the `"use workflow"` and `"use step"` directives.

Three things the docs settled that the design needed:

- `sleep` accepts a duration string OR a `Date`. `sleep(lead.nextCallAt)` is
  therefore the literal expression of the schedule, with no arithmetic in the
  workflow.
- The sandbox FIXES `Date` and `Math.random` across replays for determinism.
  This reinforces design D3 from a second direction: the workflow must not
  compute times itself even if it looks convenient, because the value it reads
  is pinned to the first replay.
- A trap that does NOT apply here, checked rather than assumed: a Next.js proxy
  whose matcher swallows `/.well-known/workflow/*` breaks run resumption
  silently. `apps/web/src/proxy.ts` matches `["/portal/:path*"]`, so Workflow's
  internal paths are already outside it. No change needed — but any future
  widening of that matcher must exclude `.well-known/workflow/`.

- [x] 1.2 Install the SDK and run one trivial workflow — a `sleep` of a few
  seconds and a step that reads one row — under `pnpm dev` (`next dev`), under
  `pnpm dev:voice` (`vercel dev`) and on a deployment. Use `npx workflow health`
  and `npx workflow inspect runs`. Record WHERE a run actually executes, exactly
  as change 4 recorded the WebSocket upgrade table in the README

MEASURED with a throwaway workflow (`sleep("5s")` between two steps that each
counted the leads table), since deleted:

| Command | Builder | `start()` | Step 1 | Step 2 | Verdict |
| --- | --- | --- | --- | --- | --- |
| `pnpm dev` (`next dev`) | 5 steps, 1 workflow, 97 ms | 2.1 s | 05:35:02 | 05:35:08 | works |
| `pnpm dev:voice` (`vercel dev`) | 5 steps, 1 workflow, 112 ms | 0.4 s | 05:38:24 | 05:38:29 | works |
| a deployment | — | — | — | — | DEFERRED, see below |

Both local servers run workflows, both suspend across the sleep and resume ~5.3 s
later, and both reach Postgres from inside a step. `npx workflow inspect runs`
reported the run `C = completed`. **So, unlike the media bridge, the scheduler
imposes no constraint on the development loop: `pnpm dev` is enough.**

The deployment leg is DEFERRED to task 9.2 on purpose. Locally the SDK uses the
Local World (filesystem plus an in-memory queue); a deployment uses the Vercel
World, which is a genuinely different backend and does deserve the check. But
proving it with the throwaway would have meant publishing an unauthenticated
`POST /api/internal/spike` to a production domain that Twilio already reaches,
and section 9 exercises the same path through the real workflow behind real
authentication. The check is not skipped, it is sequenced.

Two findings that changed code:

- **A step may only import what `apps/web` itself depends on.** The workflow
  builder bundles step files with esbuild from `apps/web`, so `import
  "drizzle-orm"` inside a step fails to resolve under pnpm's strict
  `node_modules` — `drizzle-orm` is a dependency of `@solarwave/db`, not of the
  app. Every database touch has to go through a query function exported from the
  `@solarwave/db` barrel. That is the architecture the project already wanted;
  the bundler now enforces it.
- **Local run state lives in `apps/web/.next/workflow-data`**, not in the
  documented `.workflow-data/`. It is therefore already gitignored via `.next/`
  — and `rm -rf apps/web/.next`, which this project's own conventions prescribe
  after a `TurbopackInternalError`, DESTROYS local workflow runs. Worth knowing
  before a sleeping run is mistaken for a broken one.

- [x] 1.3 Establish whether a durable `sleep` survives two days on Hobby, given
  the one-day run retention the decision log records. Read
  `node_modules/workflow/docs/api-reference/workflow/sleep.mdx` first; if the
  documentation does not settle it, start a run with a sleep past the boundary and
  come back to it. This selects the rung in design D11 and it is the single most
  consequential answer in the section

SETTLED, and the answer is rung 1. The SDK docs defer the numbers to Vercel, and
Vercel's Workflow pricing and limits page is unambiguous:

| Limit | Value |
| --- | --- |
| Maximum run duration | **No limit** |
| Maximum `sleep` duration | **No limit** |
| Events per run | 25,000 |
| Steps per run | 10,000 |
| Storage retention **after run completion** (Hobby) | 1 day |

The decision log's "1-day run retention" was reading the retention row as if it
killed live runs. It does not: it is retention of the stored event log **after a
run completes**, so a run that is asleep is not subject to it. The two-day retry
is a `sleep` and needs no fallback.

The second number that matters: Hobby includes 50,000 workflow events a month,
and a step produces three (`step_created`, `step_started`, `step_completed`). A
lead that goes to three attempts costs well under a hundred events, so a demo's
volume is nowhere near the allowance. Exceeding it on Hobby stops the feature
rather than producing a bill — there is no card on this account, which change 4
already established when the AI Gateway refused to serve without one.

- [x] 1.4 Confirm the Vercel Hobby cron limits from the platform rather than from
  memory: how many cron jobs a project may have and the minimum interval. Design
  D7 consolidates four periodic tasks into one job because the decision log says
  once per day; verify it

MEASURED, and it CORRECTS design D7's stated reason:

| Plan | Cron jobs per project | Minimum interval | Precision |
| --- | --- | --- | --- |
| **Hobby** | **100** | **once per day** | per-hour (±59 min) |
| Pro | 100 | once per minute | per-minute |

So the scarce resource is FREQUENCY, not COUNT — the design said both, and the
count half was wrong. Consolidation into one daily job stands, but on its real
merits: the four tasks want the same cadence, they share a transaction-free
sequence, and the keep-alive falls out of any job that touches the database.
Design D7 has been corrected rather than left with a justification that does not
hold.

Also worth having in writing, because it fails at the wrong moment otherwise: a
cron expression that would run more than once a day **fails at deployment** on
Hobby, with `Hobby accounts are limited to daily cron jobs`. It is not silently
downgraded.

- [x] 1.5 Establish whether Supabase Realtime delivers changes on these tables,
  which Drizzle created with no row-level security, and what an authenticated
  browser client would be able to read if it did. Design D10 has already chosen
  polling as the fallback — the spike decides which one is built, and a Realtime
  path that would expose more than the portal already shows is not chosen

MEASURED against the live database, and **the answer is polling**. Queried
`pg_publication`, `pg_publication_tables`, `pg_class` and `pg_policy`:

| Fact | Value |
| --- | --- |
| `realtime` schema installed | yes |
| `supabase_realtime` publication exists | yes, `puballtables = false` |
| Tables in that publication | **none** |
| RLS enabled on any of the nine tables | **no** |
| Row-level policies defined | **zero** |
| `REPLICA IDENTITY` | default (primary key) on all |

Realtime broadcasts nothing today because the publication is empty. Making it
broadcast means adding `leads` to that publication — and Postgres Changes are
authorised by RLS. With RLS disabled and no policies, adding `leads` would push
every insert and update of that table, names and emails and telephone numbers
included, to any client holding the anon key. That key is
`NEXT_PUBLIC_SUPABASE_ANON_KEY`: it ships to every browser that loads the public
landing page. The live dashboard would be a public feed of the lead table.

Doing it safely means enabling RLS on `leads` and writing an employee policy —
a real change to a database whose access control currently lives entirely in the
Data Access Layer, touching every existing query path, to make a status chip
update without a click. Design D10 pre-committed the rule: a Realtime path that
would expose more than the portal already shows is not chosen. It exposes more.

**Decision: poll while any lead is `calling`, stop when none is.** Task 8.4
builds the polling path. RLS is not opened for a dashboard convenience; if it is
ever wanted for its own sake, it is its own change.

- [x] 1.6 DECISION: record in `openspec/config.yaml` which rung of design D11
  applies, and if it is rung 2 or 3, say plainly in the README what the retry
  behaviour actually is. A 15-minute retry that is really a daily sweep must not
  be described as a 15-minute retry

**RUNG 1.** `sleep` has no maximum and a live run is not subject to the
completion-retention window, so the 15-minute retry and the 2-day retry are both
durable sleeps and the README needs no apology. Recorded in
`openspec/config.yaml`.

The daily sweep of design D7 step 4 is still built — as the backstop it was
always also meant to be, not as the retry mechanism. Rungs 2 and 3 stay written
down in the design because they are what this degrades to if the platform's
limits change.

## 2. The migration and the settings store

- [x] 2.1 Add four nullable columns to `call_attempts` in
  `packages/db/src/schema.ts` — `requested_callback_raw`,
  `requested_callback_at`, `telephony_seconds`, `realtime_seconds` — and generate
  the migration with `pnpm db:generate`. Additive only; nothing existing changes
  type or nullability
- [x] 2.2 Generalise `updateSetting` and `validateSetting` in
  `packages/db/src/queries/settings.ts` from `number` to `number | boolean`,
  keeping the audit row shape and the admin-only rule. Every existing settings
  test must pass unchanged — that is the assertion that the generalisation changed
  nothing
- [x] 2.3 Add the three operational keys to `SETTING_KEYS` with their defaults —
  automatic dispatch off, a daily call budget, a voice-second budget — and seed
  them, idempotently, alongside the existing settings
- [x] 2.4 Unit-test the validation of each new setting: a boolean round-trips as a
  boolean, a negative or non-integer budget is refused with the field named, and a
  boolean change audits legibly

## 3. The brake — the budgets and the two new refusals

- [x] 3.1 Put the budget arithmetic in `packages/core` as a pure function: given
  the consumption within a window and the configured budget, does another call
  fit. Unit-test the boundaries — exactly at the budget, one under, one over, and
  an empty window — with no database
- [x] 3.2 Add the budget queries to `packages/db`: calls placed within the daily
  window, and telephony seconds recorded within the longer window. Both read from
  `call_attempts` and neither invents a figure for an attempt that recorded none
- [x] 3.3 Extend `dispatchCall` in `packages/voice/src/dispatch.ts` with the two
  refusals, evaluated INSIDE the transaction that reserves the attempt (design D4
  and `voice-bridge` D5). Add an origin to its input so the automatic dispatch
  setting binds the run and not an administrator
- [x] 3.4 Integration-test the race on the PGlite harness: two dispatches
  evaluated simultaneously with one call of budget remaining produce exactly one
  attempt and one budget refusal. This is the test that matters — a telephone call
  cannot be recalled
- [x] 3.5 Integration-test the asymmetry: with automatic dispatch disabled, a run
  origin is refused and an administrator origin is not; with a budget exhausted,
  both are refused and the reason names which budget

MEASURED 2026-09-06, and task 3.4 found a real bug before any call was placed.

The race test failed on the first run: BOTH simultaneous dispatches went through
the last unit of budget. Every refusal that existed before this change is
per-lead, and two dispatches for the same lead serialise on the lead row's
`FOR UPDATE`. A budget is a GLOBAL aggregate, so two dispatches for DIFFERENT
leads lock different rows, never serialise, both read the same count and both
pass — textbook write skew, and the one bug in this change that would have spent
real telephony to discover.

Fixed with `pg_advisory_xact_lock` taken immediately before the budget read:
transaction-scoped so it releases on commit or rollback with nothing to clean
up, taken last so it is held briefly, and deadlock-free because concurrent
dispatches hold disjoint lead locks and acquire this single global resource
after them. Dispatch is low-frequency — a demo places a handful of calls a
minute — so serialising it globally costs nothing measurable.

Suite after the fix: 14/14 in `budget.integration.test.ts`, 81/81 across the
whole `@solarwave/db` integration suite against real Postgres.

## 4. Recording what a call consumed

- [x] 4.1 Record the telephony duration the status callback reports onto the
  attempt as it closes. Do it by extending `finishAttempt`'s input in
  `packages/db`, so the callback route's own change is one field — the route is
  the instrument `real-call-proof` measures and it is edited as little as possible
- [x] 4.2 Have the media session report the realtime duration it held, and record
  it on the attempt. An attempt whose conversation never happened records none
- [x] 4.3 Integration-test both: a closed attempt carries what was reported, an
  unanswered attempt carries no realtime duration, and neither is written as a
  zero that reads like a measurement

## 5. The requested callback

- [x] 5.1 Add the validity rules to `packages/core` as a pure function beside
  `scheduleRetry`: in the future, within the horizon, then clamped by
  `nextAllowedTime`. Unit-test each rejection separately and assert the fallback
  is the unchanged interval policy
- [x] 5.2 Add the optional callback field to the extraction schema in
  `packages/scoring/src/extractionSchema.ts`, resolved in the lead's timezone and
  relative to when the call happened. Absent is the normal case and must not fail
  the pass or degrade the criteria answers
- [x] 5.3 Persist the verbatim request and the resolved instant on the attempt.
  The verbatim value is stored even when nothing resolves, so a person can always
  see what the lead asked for
- [x] 5.4 Apply it in the scoring worker: set the lead's next call time through
  the same `scheduleRetry`, and only when the policy accepts it. Guard against a
  terminal lead and, above everything, against an opted-out one — spec section 6
- [x] 5.5 Integration-test the guards on the PGlite harness: a callback request in
  a call that also opted out schedules nothing, a terminal lead is not
  rescheduled, and re-driving scoring for the same attempt produces the same next
  call time
- [x] 5.6 Add a fixture to the golden set: a transcript where the lead asks for a
  time, and one where the phrase resolves to nothing

MEASURED 2026-09-06, and task 5.2 found a bug the spec had already forbidden.

Declared the obvious way — a required object field on the extraction schema — a
model that simply OMITTED the callback key failed structured-output validation
and took every criteria answer down with it. That is precisely what the
`answer-extraction` spec says must not happen ("an absent callback time is the
normal case, not a failure"), and it is the normal case: change 3 measured this
model omitting fields it was asked for, change 4 measured it omitting required
tool arguments.

Fixed by making the field UNFAILABLE at the schema level — `z.unknown().optional()`
— with the shape carried by its description and by the prompt, and `readCallback`
enforcing it defensively. Same principle `confidence` in this file already used:
"deliberately unbounded at the schema level ... so a model writing 1.2 must not
fail an otherwise good extraction".

Two other decisions worth the record:

- **The model is asked for a LOCAL WALL CLOCK, never an instant.** Asking a
  language model for a timezone-correct ISO timestamp invites it to do offset
  arithmetic that `localToInstant` already does correctly, DST included. So the
  model resolves "amanhã de manhã" to `2026-09-07T09:00` and the conversion
  stays in code.
- **`extractAnswers` was kept as a three-line narrowing of the new `extractCall`.**
  All 79 pre-existing scoring tests then pass UNCHANGED, which is the assertion
  that adding the field changed nothing — the same pattern change 4 used when it
  extracted the call policy out of `loop.ts`.

Suites: 91 scoring unit tests, 7 callback guard integration tests against real
Postgres, and the three golden cases are wired into `pnpm eval` so the mocked
tests and the real model cannot drift.

## 6. `leadWorkflow`

- [x] 6.1 Write the steps first, as ordinary async functions in `apps/web`: read
  the lead, dispatch through `dispatchCall` with the run origin, settle scoring,
  and record the run id. They are what the PGlite harness can test directly, and
  under design D2 they are also the only place Node and the database are reachable
- [x] 6.2 Write the workflow body: re-read, exit if terminal or unscheduled, sleep
  until the next call time, dispatch, sleep out the call, settle, repeat. Control
  flow and `sleep` only — no database, no driver, no Node built-in (design D2)
- [x] 6.3 Implement the refusal handling: a permanent refusal ends the run, a
  temporary one does not (design and the `call-orchestration` spec). Get this
  wrong in the safe direction — ending a run costs a lead a retry, looping on a
  refusal costs the budget
- [x] 6.4 Implement the bounded scoring settle (design D8), re-driving
  `scoreAttempt` a fixed number of times and then giving up to the daily job
- [x] 6.5 Start a run from the intake API, writing `leads.workflow_run_id` — the
  column has existed since change 1 with nothing writing it — and add an
  administrator action to start one for a lead that has none
- [x] 6.6 Unit-test the steps against the PGlite harness, and integration-test the
  orchestration with `@workflow/vitest`: a lead that opts out during the sleep is
  never dispatched to, an exhausted lead ends the run, and two runs for one lead
  produce exactly one attempt
- [x] 6.7 Assert the reversibility claim in a test: with automatic dispatch
  disabled, running the workflow writes no lead status, closes no attempt and
  leaves the database as the callback and scoring paths left it (design D3)

MEASURED 2026-09-07. Three things worth the record.

**The steps are covered; the loop wiring is not, and that is upstream.**
`steps.integration.test.ts` runs 15 tests against real Postgres and asserts every
guard where the guard actually lives: the opt-out refusal, the
automatic-dispatch refusal, the terminal-lead exit, the serializability of what
crosses a step boundary, and D3's "writes no lifecycle state". The orchestration
suite is WRITTEN and GATED, not deleted — `@workflow/vitest` cannot run here:

    [local world] Queue operation failed: TypeError: Module
    ".../builtin-modules/builtin-modules.json" needs an import attribute of
    "type: json"

Every enqueue fails, so no step executes and every run hangs. `builtin-modules`
is a transitive dependency of `@workflow/builders` and the JSON is imported
without Node 22's required `with { type: "json" }`. Reproduced on 5.0.0 and,
via a pnpm override, on 5.3.0 — so not a stale pin. It affects ONLY the
in-process test runtime: spike 1.2 ran real workflows under both `next dev` and
`vercel dev`, builder, suspend, resume and a Postgres read from inside a step.
Run it with `WORKFLOW_ORCHESTRATION_TESTS=1` once the upstream import is fixed;
tracked as open task 6.8 so the gap stays visible in the count.

**The orchestration suite deliberately dials nothing.** Every case is a path
that places no call, guarded twice — automatic dispatch off AND a daily budget
of zero. A workflow test that dials is a workflow test that spends Twilio
minutes out of an allowance of seventy-five.

**A bug the step tests caught.** `dispatchCall` checked `no_active_criteria`
before the automatic-dispatch switch, so a run with the switch off reported the
wrong reason AND still loaded criteria and reconciled attempts every time it
woke. The switch is now checked first for a run origin — and still checked again
inside the reserving transaction, where it is race-proof.

**Design refinement, D3.** The run id is written by the STARTER, not by the
workflow, which leaves the workflow writing nothing at all — a cleaner statement
of D3 than the design's original "writes `workflow_run_id` once".

- [ ] 6.8 OPEN, blocked upstream. Run the orchestration suite
  (`pnpm --filter web test:workflow` with `WORKFLOW_ORCHESTRATION_TESTS=1`) once
  `@workflow/builders` imports its JSON with an import attribute. Until then the
  loop wiring is proven only by section 9.2's end-to-end simulated run

## 7. The daily maintenance job

- [x] 7.1 Add the purge query to `packages/db`: delete transcripts past
  `transcript_expires_at`, leaving the attempt row, its outcome and its answers
  intact. Integration-test that an in-retention transcript is untouched
- [x] 7.2 Add the scoring recovery query: attempts closed with a transcript whose
  scoring status is `pending` or `failed`, and re-drive `scoreAttempt` for each.
  Integration-test that a scored attempt is not re-scored
- [x] 7.3 Add the overdue sweep: leads whose next call time is more than the
  margin in the past, dispatched through `dispatchCall` and therefore subject to
  every refusal and both budgets. Integration-test that an opted-out lead carrying
  a stale next call time is never dispatched for
- [x] 7.4 Write `POST /api/cron/maintenance` behind `CRON_SECRET`, running the
  purge, `reconcileStaleAttempts`, the recovery and the sweep independently, so
  one failure does not stop the rest, and reporting each outcome
- [x] 7.5 Add the `crons` entry to `apps/web/vercel.json` at the frequency spike
  1.4 confirmed, leaving the media route's `maxDuration` untouched. Document
  `CRON_SECRET` in `apps/web/.env.example`
- [x] 7.6 Test the route: an unauthenticated request performs no work, and a
  failing purge still lets the other three run and reports itself as failed

## 8. The portal

- [x] 8.1 Add the operations view: automatic dispatch, both budgets and the
  consumption against each, editable by an administrator and read-only for an
  agent. Reuse the existing settings form and audit path rather than adding a
  second one
- [x] 8.2 Show per-attempt consumption on the lead detail, with the realtime
  figure labelled as observed rather than metered, and nothing shown for an
  attempt that recorded nothing
- [x] 8.3 Show the requested callback on the lead detail: the verbatim phrase, and
  whether it scheduled the next attempt or the standard retry applied
- [x] 8.4 Implement the live dashboard by whichever path spike 1.5 chose, stopping
  the subscription or the polling when no lead is in a call
- [x] 8.5 Surface the two new refusal reasons in the existing "a refused call
  explains why" path, in both languages

## 9. End to end, and the write-up

- [x] 9.1 `pnpm build` before believing anything — the only check that exercises
  the server/client module boundary. The workflow module is new and a Client
  Component must not be able to reach `@solarwave/db` through it. Delete
  `apps/web/.next` first if a previous run left a `TurbopackInternalError`
- [x] 9.2 Drive the whole loop with SIMULATED calls and no telephony: a seeded
  lead reaches a terminal status through the workflow, its attempts appear, its
  score lands and the run ends. The realtime allowance cannot be spent on a
  scheduler, and this change must be provable without it

CORRECTED, because the task as written is not achievable and the reason is
worth keeping: the workflow's dispatch step is REAL telephony by construction.
A simulated call is a separate admin action that never goes through
`dispatchCall`, so "drive the loop with simulated calls" describes a path that
does not exist. Nothing was bent to make it pass.

What was proven instead, against the running app and the real database on
2026-09-08:

| Claim | Evidence |
| --- | --- |
| Intake starts a durable run | `POST /api/leads` returned `created`; `npx workflow inspect runs` showed `leadWorkflow` `R` |
| `workflow_run_id` finally has a writer | the lead carried `wrun_01M1Z9AE5KKJ88TW5FZ43VX7G2` — a column unwritten since change 1 |
| The window rule reaches the schedule | created at 22:15 local, `next_call_at` came back 08:00 the next morning |
| The run writes no lifecycle state (D3) | with the run asleep, the lead stayed `new` with `attempt_count` 0 |

The loop's INTERNAL wiring — that it calls those steps in the design's order —
remains proven only by the step tests, because the orchestration suite is
blocked upstream (task 6.8).

- [x] 9.3 Prove the brake end to end: with automatic dispatch off, the workflow
  places nothing; enabled with a budget of one, it places one and is refused the
  second; the audit page shows who enabled it

MEASURED 2026-09-08, and this is the test that mattered most, because it was run
at the moment of maximum risk: automatic dispatch ON, the call window OPEN, and
Twilio fully configured. The only thing between the system and a real telephone
call was the budget.

    POST /api/internal/call
    {"status":"refused","reason":"budget_exhausted","detail":"daily_calls: 0/0"}

The first attempt at this test was refused by `outside_call_window` instead —
22:20 in Sao Paulo — which proves the window rule but not the budget. It was
re-run against a DDD 68 (Acre, UTC-5) lead where it was 20:20 and the window was
genuinely open, so the budget was reached and was what refused. Defaults were
restored afterwards and both verification leads deleted.

- [x] 9.4 Prove the opt-out path end to end, because a scheduler is where spec
  section 6 is easiest to break by accident: an opted-out lead is never dispatched
  to by the run, never by the sweep, and re-submitting the intake form does not
  reschedule that phone

MEASURED 2026-09-08 on the running app:

- After the opt-out transition: `status: opt_out`, `next_call_at: null`,
  `opt_out_at` set.
- Re-submitting the intake form for that phone returned `existing` and
  `nextCallAt: null` — no reschedule, and no second run started.
- `POST /api/internal/call` for that lead: `{"status":"refused","reason":"opted_out"}`.
- The sweep excludes it at the QUERY (`listOverdueLeads` filters `opt_out_at`),
  asserted in `maintenance.integration.test.ts`.

An operational note found while doing this, and worth having in writing: the
integration suites TRUNCATE the shared database when `DATABASE_URL` points at a
real server. Criteria and settings vanish, and the next dispatch refuses with
`no_active_criteria` for reasons that have nothing to do with the code. Run
`pnpm db:seed` after an integration run before testing anything by hand.

And a pre-existing bug that note uncovered: `pnpm db:seed` then FAILED. The seed
upserts a lead on conflict with `id`, but the constraint that actually fires is
the UNIQUE on `phone`, so a leftover test row holding a demo phone under a
different id broke the whole seed. The README has always called the seed
idempotent; it was not. The seed now clears a demo phone held under another id
before inserting — touching only phone numbers that belong to the demo data —
and running it twice in a row now succeeds twice.
- [x] 9.5 Update `openspec/config.yaml`: the repository state, the settled open
  questions (callback-requested; the scheduler transport; the keep-alive), the
  spike measurements and the D11 rung
- [x] 9.6 Update `README.md`: the state of the build, the new route and cron, the
  operational settings and their defaults, and — if spike 1.3 said so — what the
  retry behaviour honestly is
