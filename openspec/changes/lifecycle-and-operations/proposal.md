## Why

Intake writes `next_call_at` and nothing reads it. Four changes in, a call is
placed only when an admin presses a button: the retry policy is pure, tested and
never exercised; `no_answer_final` is a reachable state no lead has ever reached
on its own; `workflow_run_id` is a column nothing writes; and `request_callback`
captures the time a lead asked for and then throws it away. The spec calls this
component the Scheduler (section 9) and describes its behaviour twice (sections
4.1 and 4.5). It is the last unbuilt piece of the automation the project exists
to demonstrate.

Two smaller absences belong with it, because they are the same kind of work —
things that must happen without anyone present. Transcripts are stamped with a
twelve-month expiry that nothing enforces (spec section 10). A Supabase free-tier
project pauses after a week without traffic, which is a demo that does not start.
And two operational gaps found while auditing the pipeline for this change: a
scoring run that throws leaves an attempt closed and permanently unscored, with
only the portal's manual button to recover it; and `reconcileStaleAttempts`, the
backstop that stops a lost status callback from freezing a lead in `calling`
forever, is only ever called by a dispatch to that same lead — so a frozen lead
unfreezes only if someone tries to call it again.

The change also carries a brake, and it is not optional caution. `voice-bridge`
measured a Gemini free-tier realtime allowance that could not sustain forty
sessions of debugging, and the Twilio trial grants 75 voice minutes over thirty
days. Until now the only thing standing between those budgets and exhaustion was
that a human had to click. This change removes the human. So it adds, in the same
breath, an audited dispatch budget that ships **off**, because the project owner's
constraint is explicit: this demonstration incurs no execution costs.

## What Changes

- **`leadWorkflow`, a durable per-lead run** started by intake and by the portal.
  It sleeps until `next_call_at`, dispatches through the existing `dispatchCall`,
  waits out the call, re-reads the lead from Postgres and either sleeps again or
  exits. It uses no hooks and it writes no lifecycle state — see the design; the
  status callback remains the single author of how an attempt ended, so the
  scheduler can be added, disabled or removed without perturbing the telephony
  path that `real-call-proof` still has to measure.
- **A lead-requested callback that reschedules.** `request_callback` currently
  captures what the lead said as free text and the attempt ends
  `answered_incomplete`. Two columns and one policy turn that into a real
  reschedule: the raw phrase is stored verbatim, the extraction pass that already
  reads the transcript resolves it to an instant, and `scheduleRetry` — which has
  accepted an explicit requested time since change 1 — uses it instead of the
  15-minute or 2-day interval. Bounded: a resolved time must be in the future,
  within a horizon, and is clamped into the 08:00–22:00 window like every other
  attempt.
- **One daily maintenance job**, not four. Vercel Hobby limits both the number of
  cron jobs and their frequency, so a single authenticated route runs the
  transcript purge, the stale-attempt reconciliation and the recovery of attempts
  whose scoring never finished — and its own database contact is what keeps the
  Supabase project from pausing. The keep-alive stops being a job and becomes a
  side effect of doing real work.
- **An audited dispatch budget, defaulting to off.** Three new settings in the
  existing key/value `settings` table, which means they arrive with the audit
  trail already built: automatic dispatch enabled or not, a daily call count
  budget, and a voice-second budget for the trial's thirty-day allowance. The
  enable flag gates the workflow only — an admin's "Call now" still works. The
  budgets gate **both**, because forty manual clicks is exactly how the Gemini
  allowance was exhausted.
- **Cost per call, in the currencies that actually run out.** Not money: telephony
  seconds and realtime seconds, recorded on the attempt when it closes, shown on
  the lead detail and summed for the budget. A budget you cannot measure is not a
  brake.
- **A dashboard that shows a call happening.** The portal learns that a lead is
  `calling` without a refresh. Supabase Realtime if it works on these tables;
  polling if it does not, decided by a spike rather than by assumption.

Deterministic and unit-tested with no model call: every workflow decision (when to
sleep, how long, when to stop), the callback-time validity rules, the budget
arithmetic and its refusals, the purge predicate, and the recovery selection. The
only LLM work this change adds is one field in the extraction schema that already
runs over every transcript — resolving "call me tomorrow morning" to an instant.
Scoring, the narrative, the judge, the conversation and the voice path are
unchanged.

## Capabilities

### New Capabilities
- `call-orchestration`: the durable per-lead run — what starts it, when it
  dispatches, how it waits out a call, how it decides between another attempt and
  an exit, why it never resurrects a terminal lead, and what happens when two runs
  exist for one lead.
- `dispatch-budget`: the operational envelope around every call — automatic
  dispatch off by default, a daily call budget and a voice-second budget, what a
  budget refusal looks like, which budgets bind a human and which bind the
  scheduler, and the per-call consumption that makes them measurable.
- `scheduled-maintenance`: the single daily job — purging transcripts past their
  twelve-month expiry, closing attempts a lost status callback abandoned,
  recovering attempts whose scoring never finished, and keeping the database
  awake by touching it.

### Modified Capabilities
- `telephony-dispatch`: two new refusals — automatic dispatch disabled, and
  budget exhausted — enforced beside the existing ones, and the recording of what
  a call consumed.
- `call-scheduling`: the policy for a lead-requested callback — when a resolved
  time is used, when it is rejected, and what happens instead.
- `answer-extraction`: the extraction pass resolves a requested callback time
  from the transcript alongside the criteria answers, in the lead's timezone.
- `criteria-management`: the operational settings are persisted and audited
  exactly like the hand-off threshold, so enabling automatic dispatch is a
  recorded act with a name attached.
- `lead-portal`: an operations view for the settings and the budget, a lead
  detail that shows what a call consumed and what callback the lead asked for,
  and a dashboard that updates while a call is in progress.

## Impact

- **New dependency**: the Workflow SDK (`workflow`, with `workflow/next`).
  Confirmed available on Hobby by the decision log; its local development story
  is a spike, because change 4 learned what happens when a runtime assumption
  about `next dev` goes unverified.
- **`apps/web`**: the workflow module and its steps, `POST /api/cron/maintenance`
  behind `CRON_SECRET`, a `crons` entry in `vercel.json`, and the operations view
  in the portal.
- **`packages/db`**: the maintenance queries (purge, stale scoring recovery), the
  budget queries, the callback columns, and a generalised `updateSetting` that
  accepts a boolean as well as a number.
- **`packages/core`**: the callback-time validity rules and the budget
  arithmetic, both pure and both unit-tested without a database.
- **`packages/voice`**: `dispatchCall` gains the two refusals; the media session
  reports the realtime seconds it consumed.
- **`packages/scoring`**: one field added to the extraction schema.
- **MIGRATION — the first since change 1.** `call_attempts` gains
  `requested_callback_raw`, `requested_callback_at`, `telephony_seconds` and
  `realtime_seconds`. The three new settings are rows, not columns, because
  `settings` is a key/value table. `leads.workflow_run_id` finally gets a writer.
- **Spec sections touched**: 4.1 (intake schedules the first attempt), 4.2 (the
  window), 4.5 (the retry policy, now executed), 4.7 (persistence), 6 (opt-out —
  a scheduler is where "never contact again" is most easily broken by accident),
  7 (`no_answer_final` becomes reachable without a human), 9 (the Scheduler
  component) and 10 (the transcript purge).
- **Not touched**: the conversation agent, the voice session, the audio bridge,
  the guardrail judge, the narrative, the scoring engine, the criteria model, and
  the Twilio webhooks. The status callback is deliberately left alone.

## Non-goals

- **Proving any of this on a telephone.** `real-call-proof` runs after this
  change and owns every claim that needs a connected call. This change is
  verifiable end to end with simulated calls and a dispatch function that refuses,
  and it must be, because the realtime allowance cannot be spent on a scheduler.
- **Spending anything.** No paid tier, no paid Twilio number, no queue product,
  no external scheduler service. If Vercel's free primitives cannot express a
  15-minute retry, the design says so and degrades in writing.
- **Inventing a qualification.** The workflow reads the lead's status; it never
  decides one. Only scoring produces `qualified` or `disqualified`, and only the
  status callback says how an attempt ended.
- **Replacing the manual call button.** It stays, it stays admin-only, and it
  stays subject to the budgets. It is how `real-call-proof` places its calls.
- **A general job queue, retries with backoff curves, or an admin runs
  dashboard.** One workflow shape and one daily job. Vercel's own observability
  covers inspection.
- **Outreach beyond three attempts, or any change to the retry intervals.** The
  spec's 15 minutes and 2 days are executed as written, not tuned.
