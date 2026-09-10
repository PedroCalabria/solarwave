## Context

Five changes in, everything that happens during a call is built and everything
that happens *between* calls is missing. `scheduleRetry` is pure, tested and has
never scheduled anything a machine acted on; `transition` can produce
`no_answer_final` and no lead has reached it without a human; intake writes
`next_call_at` and the only reader is a portal column. This change closes that
gap and takes the two operational chores that share its shape — work that must
happen with nobody present.

Four constraints shape every decision below.

**The Hobby plan's free primitives.** Vercel Cron on Hobby runs at most once a
day, with up to an hour of jitter, and an expression that would run more often
fails at deployment rather than being downgraded (measured, spike 1.4; the job
COUNT is generous at 100 per project — an earlier draft of this design claimed
otherwise and D7 has been corrected). A 15-minute retry therefore cannot come
from cron; it has to come from a durable sleep. That single fact is why the
Workflow SDK is in this change at all.

**Two external budgets that are already strained.** `voice-bridge` measured a
Gemini free-tier realtime allowance that degraded to nothing after roughly forty
sessions in one day, and the Twilio trial grants 75 voice minutes over thirty
days. Until now a human had to click for either to be spent. This change removes
the human, and the project owner's constraint — this demonstration incurs no
execution costs — makes the brake a requirement rather than a precaution.

**A telephony path that is finished, unproven, and about to be measured.**
`real-call-proof` runs after this change and has to observe twelve claims about
the Twilio webhooks and the media bridge, several of them with a single call out
of a scarce budget. A scheduler that rewrites how an attempt is closed would
change the thing that change exists to measure. So the design's first job is to
add automation *around* that path without editing it.

**Three authorities already exist, and they are disjoint.** The Twilio status
callback is authoritative for how an attempt ended (`voice-bridge` D4). The
scoring worker is authoritative for what the transcript said and whether the lead
qualified (`scoring-worker` D2, D3). Postgres is the source of truth for
everything, which the decision log already states as the reason the Workflow run
retention does not matter. This change adds a fourth participant, and the whole
design hangs on it being a reader.

## Goals / Non-Goals

**Goals:**

- A lead reaches a terminal status without anyone touching the portal.
- The retry intervals, the call window and the attempt cap are executed by the
  code that already computes them — no second implementation.
- Automatic dispatch cannot spend a budget by accident, and turning it on has a
  name and a timestamp attached.
- The scheduler can be switched off, or fail entirely, and the system degrades to
  exactly today's behaviour rather than to a broken one.
- The transcript purge, the stale-attempt backstop and the recovery of a failed
  scoring run all actually run.

**Non-Goals:**

- Placing a real call, or proving any of this over telephony — `real-call-proof`.
- Any spend: no paid tier, no external scheduler, no queue product.
- Deciding a qualification, or deciding how an attempt ended. Both already have
  owners and this change adds no opinion to either.
- Tuning the retry intervals. Spec section 4.5 is executed as written.

## Decisions

### D1 — The workflow polls by sleeping. It uses no hooks.

The decision log specified `sleep` plus `createHook`/`resumeHook`, with the
status callback resuming the hook when a call ends. This design keeps the sleep
and drops the hook.

The shape without hooks:

```
leadWorkflow(leadId):
  loop:
    lead = readLead(leadId)                    step
    if terminal(lead) or lead.next_call_at is null: exit
    sleep until lead.next_call_at
    result = dispatch(leadId)                  step  -> the existing dispatchCall
    if result is a refusal that will not change: exit
    sleep maxCallSeconds + margin              the call happens inside here
    settleScoring(leadId)                      step  -> bounded, see D8
  (loop re-reads and decides again)
```

A hook would wake the workflow the instant the call ended instead of roughly four
minutes later. Three reasons that buys nothing here:

1. **The saved time is invisible.** The next thing the workflow does after a call
   ends is sleep until `next_call_at`, which is at least fifteen minutes away.
   Waking four minutes earlier to sleep fifteen minutes changes no observable
   behaviour. On the terminal paths the workflow exits four minutes later than it
   might have, and nothing is watching the run — the portal reads Postgres.
2. **A hook needs the timeout anyway.** A status callback can be lost; that is
   the premise `reconcileStaleAttempts` was written for. So a hook has to race a
   timeout sleep, which means building the sleep path regardless and then adding
   the hook on top of it.
3. **The decisive one: a hook requires editing the status callback.** Something
   has to call `resumeHook`, and the only thing that knows a call ended is the
   route `real-call-proof` is about to measure. Deterministic tokens make the
   plumbing cheap (`createHook({ token })` needs no new column, since the token
   can be derived from the lead id and the attempt number both sides already
   know) — but cheap plumbing in that file is still a change to that file. The
   scheduler must not perturb the instrument.

Cost of the choice: a few extra Workflow events per attempt and up to four
idle minutes per call. On a 50,000-event monthly allowance and a demo's call
volume, neither is close to mattering.

### D2 — The workflow function orchestrates; every read and write is a step

`"use workflow"` functions run in a sandboxed VM with no Node built-ins, and
`@solarwave/db` is the postgres driver. So the workflow body contains control
flow, `sleep` and nothing else; each database touch and each call to
`dispatchCall` is a `"use step"` function, which also buys them replay caching
and retry.

This is not merely a sandbox workaround. It is what keeps the workflow testable:
the steps are ordinary async functions that the existing PGlite harness can
exercise directly, and the orchestration is the only part that needs the SDK's
test plugin.

### D3 — The workflow reads scheduling state; it never writes lifecycle state

Four participants, and the boundaries are the point:

| Who | Authoritative for | Writes |
| --- | --- | --- |
| Twilio status callback | how an attempt ended | `ended_at`, `outcome`, the transition, `next_call_at` from the interval policy |
| Scoring worker | what the transcript said, and qualification | score, reason, icebreaker, answers, violations, the requested callback (D6) |
| `dispatchCall` | whether a call may be placed at all | the attempt row, inside its transaction |
| `leadWorkflow` | **nothing** | `leads.workflow_run_id`, once, at start |

The workflow decides *when to ask* and never decides *what happened*. It cannot
put a lead in a status, cannot close an attempt and cannot invent a
qualification. Everything it needs, it re-reads from Postgres after the fact.

This is what makes the change reversible. Turn the flag off, or delete the
workflow module, and the system is exactly what it is today: a dispatch function
that refuses correctly and a status callback that closes attempts. Nothing
degrades into an inconsistent state, because nothing depended on the workflow to
be consistent.

### D4 — The brake: one flag gates the machine, the budgets gate everyone

Three settings, in the existing key/value `settings` table, which means each one
arrives with the audit row and the admin-only mutation rule already built
(`criteria-management`):

| Setting | Default | Gates |
| --- | --- | --- |
| `auto_dispatch_enabled` | **false** | the workflow's dispatch step only |
| `daily_call_budget` | a small number | every dispatch, manual included |
| `monthly_voice_seconds_budget` | the trial's 75 minutes | every dispatch, manual included |

The asymmetry is deliberate. The flag exists so the scheduler cannot start
calling the moment it is deployed, and an admin pressing "Call now" is a human
decision that does not need the machine's permission. The budgets bind both,
because the way the Gemini allowance was actually exhausted was a person running
roughly forty sessions in a day — a budget that only restrains the robot would
not have stopped the thing that happened.

Both refusals go where every other refusal already lives: inside `dispatchCall`,
returned as a reason the portal already knows how to explain. The budget is
evaluated inside the same transaction that reserves the attempt, for the reason
`voice-bridge` D5 gives — losing that race places a telephone call that cannot be
recalled.

Turning `auto_dispatch_enabled` on is therefore an audited act with an employee
name and a timestamp, which is the property that lets this ship on by default in
code and off by default in data.

### D5 — Cost is measured in the currencies that run out, not in money

This project spends no money, so a currency column would always read zero and
would brake nothing. What is actually scarce is telephony seconds against 75
minutes per thirty days, and realtime seconds against an allowance whose shape
`real-call-proof` is still measuring.

So an attempt records two integers when it closes: `telephony_seconds`, from the
duration the status callback reports, and `realtime_seconds`, from how long the
media session held its provider connection. The budget queries sum them over a
window. The lead detail shows them per attempt.

The honest limitation, stated here so it is not discovered later: the realtime
figure is what our bridge observed, not what the provider metered, and the two
may not agree. It is good enough to brake on and it is not a bill.

### D6 — A requested callback is resolved by the extraction pass and applied by scoring

`request_callback` gives us a phrase, not a timestamp — "amanhã de manhã",
"depois das seis". `scheduleRetry` has accepted an explicit `requestedAt` since
change 1 and nothing has ever passed one. Something has to turn the phrase into
an instant.

**Where:** the extraction pass, which already runs one LLM call over every
transcript under a criteria-derived schema. One added field, in the lead's
timezone. A second model call to parse a time would be a second failure mode for
no gain. Change 3 measured that the model omits required arguments, so the field
is optional and its absence is the normal case.

**Who applies it:** the scoring worker, not the workflow. This was the closer
call. Letting the workflow apply it is tidier — the workflow is the scheduler —
but `auto_dispatch_enabled` defaults to false, so the workflow is usually not
running, and a feature that only works once someone enables the robot is a
feature that is off in the default demo. Scoring runs either way.

**Bounded, because an LLM produced it.** The resolved time is used only when it
is in the future, no further away than a horizon, and it is clamped into the
08:00–22:00 window by the same `nextAllowedTime` every other attempt goes
through. Fail any of those and the interval policy stands, unchanged. The raw
phrase is stored verbatim and shown on the lead detail either way, so a human can
always see what the lead actually asked for and what the machine did with it.

The guard that matters most: a requested callback never moves a lead out of a
terminal status and never reschedules an opted-out phone. Spec section 6 puts
opt-out above every other rule, and a scheduler is the easiest place in this
system to break it by accident.

### D7 — One daily job, and the keep-alive is a side effect of it

CORRECTED by spike 1.4. The original reason given here was that Hobby caps both
cron frequency and cron count. The frequency half is right — once per day, and a
more frequent expression FAILS AT DEPLOYMENT rather than being downgraded. The
count half was wrong: Hobby allows 100 cron jobs per project.

So consolidation is not forced by scarcity, and it survives on its own merits:
the four tasks want the same cadence, none of them depends on another's result,
one authenticated route is one secret to hold rather than four, and the
keep-alive falls out of any job that touches the database. One authenticated
route, run once a day, doing them in order:

1. **Purge** transcripts past `transcript_expires_at` (spec section 10). The
   expiry has been stamped on every closed attempt since `voice-bridge`; nothing
   has ever enforced it.
2. **Reconcile** attempts a lost status callback abandoned. `reconcileStaleAttempts`
   exists and its only caller is a dispatch to the same lead — so a lead frozen in
   `calling` unfreezes only if someone tries to call it again, which is precisely
   the situation where they cannot.
3. **Recover** attempts that closed with a transcript and whose scoring never
   finished. Today a throw inside `scoreAttempt` leaves `scoring_status` at
   `pending` forever, recoverable only by the portal's manual button.
4. **Sweep** leads whose `next_call_at` is overdue by more than an hour — the
   degradation path of D11, and a backstop even when the workflow is healthy. The
   hour of slack guarantees a running workflow always wins the race, and
   `createDispatchedAttempt`'s transaction makes losing it harmless anyway.

There is no fifth step for the Supabase keep-alive. A job that reads and writes
the database every day *is* the keep-alive; giving it a separate cron slot would
spend a scarce Hobby resource to do less.

### D8 — The workflow is a second recovery path for scoring, bounded

After its post-call sleep, the workflow checks whether the attempt it just caused
has settled: closed, and scored if it had a transcript. If scoring is still
`pending` or `failed`, it re-drives `scoreAttempt` a bounded number of times
before reading the lead and deciding.

This is not a new authority. `scoreAttempt` remains the only thing that scores;
the workflow only calls it again. It matters because scoring is what turns
`answered_complete` into `qualified` or `disqualified`, and a workflow that read
the lead before scoring landed would see `calling` and draw the wrong conclusion.
The daily job's step 3 catches whatever this misses.

### D9 — Two runs for one lead are made harmless by the transaction, not by the run id

`leads.workflow_run_id` gets its first writer here, and it is for observability —
a link from a lead to its run — not for mutual exclusion. Intake starts a run;
the portal can start one for a lead that has none; a redeploy or a manual restart
can produce a second. Guarding that with a column means a compare-and-set race
across a serverless boundary, and losing it silently means a lead nobody
schedules.

The real guard already exists and is stronger: `createDispatchedAttempt` reads the
lead `FOR UPDATE` and refuses `opted_out`, `attempt_in_flight` and
`attempt_cap_reached` inside the transaction that reserves the attempt number.
Two runs racing produce one attempt and one refusal. A duplicate run is wasted
sleep, not a duplicate call — and wasted sleep is free.

### D10 — The live dashboard is decided by a spike, with polling as the named fallback

The decision log says Supabase Realtime for the `calling` state. These tables were
created by Drizzle migrations and carry no row-level security policies, and
Realtime's delivery to a browser client is bound up with RLS and publication
membership. Whether it works here, and what it would expose if it did, is not
knowable from the decision log.

So it is a spike with a fallback already chosen: polling the leads list while any
lead is `calling`, and stopping when none is. Same shape as `voice-bridge`'s
Fly.io fallback — the feature is specified by what the user sees, and the
transport is allowed to be the cheaper one.

**RESOLVED by spike 1.5, and the answer is polling.** Measured against the live
database: the `supabase_realtime` publication exists and is EMPTY, RLS is
disabled on all nine tables, and there are zero row-level policies. Realtime
therefore broadcasts nothing today, and making it broadcast means adding `leads`
to that publication — where Postgres Changes are authorised by RLS. With no RLS
and no policies, that pushes every lead insert and update, names and emails and
telephone numbers included, to any client holding
`NEXT_PUBLIC_SUPABASE_ANON_KEY` — a key that ships to every browser loading the
public landing page. The live dashboard would be a public feed of the lead table.

Making it safe means enabling RLS on `leads` and writing an employee policy: a
real change to a database whose access control lives entirely in the Data Access
Layer today, touching every existing query path, to save a click. This decision
pre-committed the rule — a Realtime path that would expose more than the portal
already shows is not chosen — and the measurement says it would. Polling it is.
If RLS is ever wanted for its own sake, that is its own change, not a dashboard
convenience.

### D11 — What happens if the Workflow spike fails, in writing and in advance

**RESOLVED by spike 1.3: RUNG 1.** Vercel's Workflow limits give "Maximum run
duration: No limit" and "Maximum `sleep` duration: No limit", and the Hobby
retention row is retention of the stored event log AFTER A RUN COMPLETES — it
does not reap a run that is asleep. The decision log had been reading that row as
a cap on live runs. Both retries are durable sleeps; no fallback is needed. The
daily sweep in D7 step 4 is still built, as the backstop it was always also meant
to be rather than as the retry mechanism.

The ladder stays written down, because it is what this degrades to if the
platform's limits move:

| Rung | Condition | Behaviour |
| --- | --- | --- |
| 1 | Workflow runs on Hobby and a 2-day sleep survives | Full. Both retries are sleeps |
| 2 | Workflow runs; long sleeps do not survive | The 15-minute retry is a sleep; the 2-day retry is picked up by the daily sweep (D7 step 4) |
| 3 | Workflow is unusable | Every retry is picked up by the daily sweep. The 15-minute retry becomes "the next daily sweep", and the README says so |

Rung 3 is a real product degradation and it is not hidden by rounding it into a
success. It is also survivable for a demonstration, because the manual call
button and the simulated call both remain, and because the sweep is being built
anyway as the backstop in D7.

## Risks / Trade-offs

- **The Workflow SDK is new to this repository and its local story is unknown.**
  `voice-bridge` learned that `next dev` does not perform a WebSocket upgrade and
  that the discovery reorganised the whole development loop. Mitigated by making
  it spike 1.1, before any code depends on the answer.
- **A scheduler that works is a scheduler that spends.** Mitigated by D4, and by
  the flag defaulting to false so that deploying this change changes no behaviour
  until someone deliberately and auditably enables it.
- **An LLM-resolved callback time could place a call at a strange hour.**
  Bounded by D6: future, within a horizon, clamped to the window, never on a
  terminal or opted-out lead, and always displayed next to the raw phrase.
- **The daily sweep and the workflow could both dispatch.** Made harmless by
  `createDispatchedAttempt`'s transaction and made unlikely by the one-hour
  overdue margin.
- **Up to four idle minutes per call inside the workflow (D1).** Accepted; it is
  invisible against a fifteen-minute retry.
- **The realtime-seconds figure is ours, not the provider's (D5).** Accepted and
  documented rather than presented as metering.
- **This change cannot be proven over telephony.** By design — it is verified
  with simulated calls, refusals and the PGlite harness, and `real-call-proof`
  owns the phone.

## Migration Plan

One migration, the first since change 1, and it is additive only:

- `call_attempts.requested_callback_raw` (text, null) — what the lead said.
- `call_attempts.requested_callback_at` (timestamptz, null) — what it resolved to.
- `call_attempts.telephony_seconds` (integer, null) — D5.
- `call_attempts.realtime_seconds` (integer, null) — D5.

The three settings are rows in the existing key/value `settings` table, seeded
with their defaults, so no schema change and the audit trail is inherited.
`updateSetting` is generalised from `number` to `number | boolean`, keeping the
audit row shape.

New environment: `CRON_SECRET` for the maintenance route. New `vercel.json` key:
`crons`, one entry. Existing keys unchanged — the media route keeps its 300-second
`maxDuration`.

Rollback: disable the cron entry and set `auto_dispatch_enabled` to false. The
columns are nullable and unread by anything else; the system returns to
`voice-bridge` behaviour with no data migration.

## Open Questions

ALL FOUR ANSWERED 2026-09-06 by section 1 of the tasks. Kept here with their
answers, because a design that only records its questions is half a record:

- **Where does a Workflow run, locally?** BOTH `next dev` and `vercel dev` run
  workflows, suspend across a sleep and reach Postgres from a step. Unlike the
  media bridge, the scheduler puts no constraint on the development loop. The
  deployment leg — the Vercel World rather than the Local World — is sequenced
  into task 9.2 rather than proven with a throwaway unauthenticated route.
- **Does a durable `sleep` survive two days on Hobby?** YES. No maximum run
  duration, no maximum sleep duration; the 1-day figure is retention after
  completion. Rung 1 of D11.
- **How many cron jobs does Hobby allow, and at what frequency?** 100 jobs, once
  per day, ±59 minutes, and a more frequent expression fails at deployment. D7's
  count-scarcity argument was wrong and has been corrected in place.
- **Does Supabase Realtime deliver on tables with no RLS, and what does it
  expose?** It delivers nothing today (empty publication), and enabling it
  without RLS would expose the whole lead table to the public anon key. Polling
  is chosen. See D10.

Settled here, and recorded against the config's standing list:

- **Callback-requested** (open since `conversation-agent-text`): two columns, the
  extraction pass resolves it, the scoring worker applies it under D6's bounds.
  No agent change, exactly as the decision log predicted.
- **The scheduler's transport**: `sleep` only, no hooks (D1), overriding the
  decision log's `createHook`/`resumeHook` note with the reasoning above.
- **The keep-alive**: not a job (D7).
