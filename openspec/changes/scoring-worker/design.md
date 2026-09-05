## Context

`persistent-foundations` left the deterministic half of qualification finished:
`scoreLead` in `@solarwave/core` is pure, unit-tested and already satisfies
every requirement in the `qualification-scoring` spec, and the schema carries
`call_attempts.transcript`, `call_attempts.scoring_status`,
`qualification_answers` (with `normalized_value`, `confidence`, `evidence`,
`passed`), `guardrail_violations` and the `settings` rows. The portal lead
detail already renders score, reason, icebreaker, answers with evidence and the
transcript.

Nothing bridges the two. There is no LLM dependency in any `package.json`, no
adapter package, and `guardrail_violations` is written by nobody and read by
nobody. `workflow_run_id` exists as a column but Vercel Workflow is not wired,
so this change has no production caller yet.

Constraints: Vercel Hobby, Gemini free tier, and a Twilio trial budget of about
35 two-minute calls that must not be spent on debugging extraction.

## Goals / Non-Goals

**Goals:**
- Produce score, reason, icebreaker and guardrail findings from a stored
  transcript, with no telephony involved.
- Keep the score reproducible: identical answers plus identical criteria and
  settings always yield an identical score.
- Make extraction quality measurable today against the seeded transcripts.
- Leave a single, clean entry point for the workflow in change 5 to call.

**Non-Goals:**
- `leadWorkflow`, Twilio, realtime audio, the live `record_answer` tool.
- The criterion question linter (change 3).
- Any automatic recomputation.
- Confidence influencing the score or the retry policy.

## Decisions

### D1 — Entry point is a function plus a protected internal route

`scoreAttempt(attemptId)` in `@solarwave/scoring`, wrapped by
`POST /api/internal/score` guarded by a shared secret header. Change 5's
workflow step will call the function directly.

*Alternatives:* a CLI-only script was rejected because it never exercises the
HTTP path the workflow will use; building a minimal `leadWorkflow` here was
rejected because it steals scope from change 5 and couples this change to a
public-beta product.

### D2 — Settles the config open question: no `scoring` lead status

**The open question in `openspec/config.yaml` — "intermediate status between
call end and scoring: keep `calling` until scored, or add `scoring` to the
lifecycle" — is settled as: keep `calling`.**

Rationale: scoring runs inside the same workflow step that observes the call
ending, so the window is seconds, not minutes. Adding `scoring` would mean a
`pgEnum` migration, a new row in the transition table, a new entry in the
portal `STATUS` map and a new realtime badge state, all to describe a state no
human would ever catch in the dashboard. `call_attempts.scoring_status` already
carries the machine-facing detail for the rare case that matters.

*Consequence:* `LEAD_STATUSES` and the portal `STATUS` map are untouched by this
change.

### D3 — A failed scoring never moves the lead

`scoreAttempt` retries transient model failures with exponential backoff inside
the worker. When the retries are exhausted it sets
`call_attempts.scoring_status = 'failed'` and stops. It does **not** call
`applyLeadTransition`. The lead keeps whatever status it had, and the portal
lists the attempt under scoring pendings so an employee can retrigger.

Rationale: `transition()` requires a `decision` for an `answered_complete`
outcome, and a failed scoring has no decision to give. Inventing one would put
a fabricated qualification in front of a human. Leaving the lead untouched with
a visible pending is honest and recoverable.

*Alternative rejected:* falling back to the live agent's `record_answer` values.
The decision log calls those advisory and names post-call extraction the source
of truth; scoring from them would contradict that and produce a score that a
later reprocessing silently changes.

### D4 — `packages/ai` for adapters, `packages/scoring` for the pipeline

`@solarwave/ai` holds one thin function per model interaction with an injectable
client, so tests mock the adapter and never the SDK. `@solarwave/scoring` holds
orchestration, persistence and the deterministic classification logic.

Rationale: `conversation-agent-text` (change 3) and `voice-bridge` (change 4)
need the same adapters. Keeping them in `apps/web/src/lib` would force a move
two changes from now. Model ids live in environment variables because the
Gemini ids are preview-stage and the decision log forbids trusting memory for
them.

### D5 — Enum criteria carry a vocabulary separate from their pass rule

`qualification_criteria` gains a nullable `options` column: the full vocabulary
an enum criterion can be answered with, pipe-separated in the same grammar as
`expected_value`. `expected_value` keeps its existing meaning, the subset that
passes.

The two were conflated, and the seeded data proves they are different things.
`purchase_timeline` has `expected_value = "this_month|within_3_months"`, yet the
seeded lead James answers `within_6_months` — a real, representable answer that
simply fails. The audit log records that `within_6_months` was removed from
`expected_value` on 2026-08-21, which changed what passes and not what can be
said. The main `qualification-scoring` spec makes the same point: a `ceramic|metal`
criterion answered `slab` fails, so `slab` has to be expressible.

With the vocabulary separated, the generator emits per active criterion:

```
boolean    -> { value: boolean | null, ... }
numeric    -> { value: number | null, ... }
enum       -> { value: <exact literals from options> | null, ... }
free_text  -> { value: string | null, ... }
```

Every property also carries `confidence` (0..1) and `evidence` (a quote from the
transcript).

Rationale, and the sharpest correctness point in this change: `evaluateRule`
matches enum answers by exact string against the parsed `expected_value` list.
The seeded lead says "esse mes mesmo"; a schema derived from the type alone
would let the model return that phrase, `evaluateRule` would return `false` with
no error, and the lead would quietly lose 20 points. Constraining the model to
the `options` literals removes the failure mode instead of detecting it — while
still letting it answer with a value that fails. A schema constrained to
`expected_value` would have been worse than the bug: no enum criterion could
ever fail.

Validation, enforced when an employee saves a criterion: an enum criterion MUST
have at least two options, `expected_value` MUST be a non-empty subset of them,
and a non-enum criterion MUST NOT have options. The generator reuses the core
parser for both lists, so the schema and the engine cannot drift apart.

### D6 — The persisted answer is the boundary of determinism

The score is a function of the rows in `qualification_answers`, never of the
transcript. Consequences:

- Extraction writes all answers for an attempt as one transactional upsert on
  the existing `unique(call_attempt_id, criteria_id)`, never an incremental
  append, so a retried run cannot mix results from two executions.
- `scored_at` is stamped in the same transaction as the answers, the score and
  the narrative.
- Re-running extraction over the same transcript may legitimately produce
  different answers. That is acceptable precisely because it only happens
  through an explicit human action (D9).

### D7 — Confidence is recorded, never acted on

`qualification_answers.confidence` is stored and displayed in the portal, sorted
so low-confidence answers surface first. The engine does not receive it.

*Alternative rejected:* treating low confidence as unanswered. That would feed
`answeredWeightShare`, flip `enoughInformation`, produce `answered_incomplete`
and schedule another phone call — turning model hesitancy into spend against a
budget of roughly 35 calls, and into a second call to a lead who already
answered.

### D8 — The judge covers the text-detectable guardrails, with fixed severities

Seven of the twelve guardrails in spec section 6 are detectable from a
transcript and are judged here: prices or savings percentages, installation
timelines, specific technical claims, financial advice, competitor comparison,
artificial urgency, and unnecessary sensitive data. Plus the opt-out safety net
(D8b).

The remaining guardrails — AI self-identification, graceful exit on hostility,
detecting that a minor answered, redirecting out-of-scope questions — are
realtime behaviours belonging to the conversation agent and are evaluated in
change 3's persona suite.

`severity` comes from a fixed table keyed by guardrail, not from the model.
Letting the judge pick severity would make the same violation rank differently
across runs, which conflicts with a change whose whole premise is reproducible
output.

### D8b — The judge never writes `opt_out`

When the transcript shows opt-out intent that the live agent did not capture,
the worker raises a `severity = 'high'` violation with the quoted evidence and
clears `leads.next_call_at`. It never sets status `opt_out`.

Rationale: `opt_out` is terminal and irreversible by design — nothing leaves it.
A false positive would permanently kill a good lead with no path back, and
model output is exactly the kind of input that produces false positives. A
false negative is bounded instead: scheduling is already stopped, and a human
confirms. This is only defensible because the violations view and its review
action are in scope for this change; without a reader the safety net would be
silence.

*Consequence:* `guardrail_violations` gains nullable `reviewed_at` and
`reviewed_by`, and an unreviewed high-severity opt-out violation is a hard stop
that change 5's scheduler must honour before dispatching.

### D9 — Recomputation is manual, and the audit log says which kind

Nothing recomputes on its own. A lead is stale when
`max(criteria_audit_log.changed_at) > call_attempts.scored_at`, which is why
`scored_at` is added — `updated_at` is touched by unrelated writes and cannot
carry this meaning.

The audit log's `field` column classifies the change deterministically, with no
heuristic and no model:

| Field changed after `scored_at` | Path |
| --- | --- |
| `weight`, `blocking`, `sortOrder` | pure re-score |
| `setting:handoff_threshold`, `setting:min_answered_weight_share` | pure re-score |
| `deleted`, `active` true to false | pure re-score |
| `expectedValue`, on any criterion type | pure re-score |
| `created`, `active` false to true | reprocess transcript |
| `type` | reprocess transcript |
| `options` on an `enum` criterion | reprocess transcript |
| `key`, `label`, `questionPt`, `questionEn` | no effect on the score |

A pure re-score is free, instant and needs no model — it reruns `scoreLead` over
the stored answers, which is what the `qualification-scoring` scenario
"Threshold change re-scores existing answers" already describes. Reprocessing
costs a model call because the stored answers have no row for a criterion that
did not exist, and an enum whose *vocabulary* changed may no longer contain the
old normalised value.

Separating `options` from `expected_value` moved a row from the expensive path
to the cheap one: narrowing or widening which enum values pass is now a free
re-score, because the stored value stays inside the unchanged vocabulary. Only
editing the vocabulary itself forces reprocessing.

The portal shows one banner whose label states which action applies, so an
employee always knows whether they are about to spend an LLM call.

### D10 — Expired transcripts freeze the score

When `transcript_expires_at` has passed and the transcript was purged under spec
section 10, reprocessing is impossible. The portal keeps the last computed score
and shows "criteria changed since scoring"; only the pure re-score path stays
available, and only when the change classifies that way.

### D11 — Narrative is one call, in the lead's language

Reason and icebreaker come from a single model call and are written in the
lead's `preferred_call_language`.

Rationale: they share the same evidence, so splitting them doubles the cost and
lets the two texts disagree. The portal chrome is English, but the icebreaker is
read aloud by a human consultant calling a Brazilian lead in Portuguese; an
English icebreaker would have to be translated by the person using it.

### D12 — Google directly, not the Vercel AI Gateway

Text calls go to Google AI Studio through `@ai-sdk/google`, with a free API key
and no payment method.

**This reverses the original decision, and the reason is worth keeping.** The
change was built against the AI Gateway, which the decision log had chosen for
its unified API, spend tracking and failover. The catalogue read cleanly, the
slugs resolved, and the adapter worked. Then the first real call came back:

> AI Gateway requires a valid credit card on file to service requests.

Every request, free credits included. The Hobby plan alone cannot make a single
model call. That is incompatible with a demonstration project whose stated
constraint is free tiers, so the Gateway is out.

*Consequences, all of them real costs:*

- **The training guarantee is gone.** The Gateway catalogue reported
  `no_training: all` for these models; Google's free tier terms let them use
  content to improve their products. The decision log's original caveat is back
  in force, and it is only acceptable because this system never handles real
  customer data. See the inverted D12b below.
- **No spend tracking, no failover, no provider-level observability.**
- **Free-tier quotas are per model and tight.** `gemini-3.8-flash` allows 20
  requests per day; scoring one attempt costs three calls (extraction,
  narrative, judge). Bulk reprocessing is bounded by this as much as by the
  manual trigger of D9. A quota error is transient and says so — it names a
  retry delay — even though it also mentions billing, so it must not be mistaken
  for the account block above.
- **The catalogue check now needs a credential.** The Gateway's model list was
  public; Google's `v1beta/models` requires the key, so the startup check cannot
  run before one is provisioned.
- **One catalogue, not two.** The voice bridge in change 4 already had to call
  Google directly for realtime audio. Both halves of the product now use the
  same provider and the same key, which is simpler than the split this decision
  originally described.

*Version pin that matters:* `@ai-sdk/google@3.0.121`. It depends on
`@ai-sdk/provider@3.0.15`, the same version `ai@6.0.277` resolves; the current
`@ai-sdk/google@4` needs provider 4 and does not type against this SDK.

Model ids are plain, with no provider prefix — `gemini-3.8-flash`, never
`google/gemini-3.8-flash`. `requireModelId` rejects a leftover slug with a
message naming the fix, because the two formats look close enough to copy
forward by accident.

| Role | Model | Why |
| --- | --- | --- |
| Extraction | `gemini-3.5-flash-lite` | 100% on the golden set, with free-tier headroom |
| Narrative, judge | `gemini-3.5-flash-lite` | Short, well-constrained tasks |

Measured, not assumed. The first choice was `gemini-3.8-flash`, on the reasoning
that extraction is the source of truth so accuracy should outrank cost. The eval
disagreed on the second half of that:

| | `gemini-3.8-flash` | `gemini-3.5-flash-lite` |
| --- | --- | --- |
| Criteria correct | 15/15 where it answered | **25/25, every transcript** |
| Evidence verbatim | 11/11 | **18/18** |
| Free-tier quota | **20 requests per day** | no limit hit in ~30 calls |
| Complete runs | 0 of 3 — quota exhausted mid-run | 1 of 1 |

Same accuracy on this task, an order of magnitude more headroom. A model whose
daily quota one eval run exhausts cannot back a worker that also spends a call
on the narrative and another on the judge for every attempt.

`gemini-3.8-flash` stays a valid override; it was three days old when measured
and both its quota and its load will change.

List what a key can actually reach:

```
curl -H "x-goog-api-key: $GOOGLE_GENERATIVE_AI_API_KEY"   "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200"
```

The adapter boundary of D4 is what made this reversal cheap: `generateStructured`,
the extraction schema, the worker, the judge and the recomputation all take a
`LanguageModel` and never learn who is behind it. Swapping providers touched
four files in `packages/ai` and one line in `apps/web`. No test changed except
the ones that assert on the catalogue's shape.

### D12b — The training caveat is back (inverting an earlier claim)

An earlier revision of this design recorded that routing through the Gateway
removed the free-tier training caveat, because the catalogue reported
`no_training: all`. **That is no longer true and the claim is withdrawn.**

Calling Google directly puts the free-tier terms back in force: content may be
used to improve their products. This applies to the transcripts read by
extraction and by the judge, and to the narrative prompt.

It is acceptable here for exactly one reason: the decision log states this is
built for demonstration and forbids calling real customers with real data.
Before any real lead is processed, this becomes a paid-tier requirement — for
the text calls as well as the realtime one, which never had the guarantee.

*D13, which weighed the Gateway's OIDC token against a static gateway key, no
longer has a subject and has been removed.*

### D14 — Evals run out of CI

The seeded transcripts and their hand-written expected answers are the golden
set. CI runs only mocked adapters, keeping it free and deterministic. A separate
`pnpm eval` hits the real model on demand and reports per-criterion extraction
accuracy plus whether each `evidence` string is a literal substring of the
transcript.

Rationale: real model calls in CI are slow, cost tokens against a free-tier
quota and flake, which would erode trust in the suite.

## Risks / Trade-offs

- **Enum extraction drift** → mitigated at the root by D5: the schema is
  generated from `parseExpectedValue`, the same parser the engine uses.
- **Gemini free-tier rate limits throttle bulk reprocessing** → recomputation is
  per-lead and manual (D9), so a burst is bounded by human clicking; a future
  bulk action would need queueing and is out of scope.
- **A false negative in the opt-out safety net** violates the highest-priority
  guardrail of spec section 6 → the live agent's `mark_opt_out` remains the
  primary mechanism (changes 3 and 4); the judge is a second net, not the first.
- **Unreviewed high-severity violations pile up unnoticed** → the dashboard
  surfaces an unreviewed count; enforcement at dispatch time lands in change 5,
  and until then `next_call_at = null` is the actual stop.
- **`scoring_status = 'failed'` leaves the lead in `calling` indefinitely** →
  visible as a scoring pending in the portal with a retrigger action. Accepted:
  a stuck-but-visible lead beats a fabricated qualification (D3).
- **Two packages for a demo-scale project** is more ceremony than the code needs
  today → justified only by changes 3 and 4 needing the same adapters; if they
  end up not needing them, merging is cheap.
- **Free-tier terms let Google use content to improve products** → acceptable
  for a demo, and the decision log already forbids real customer data.

## Migration Plan

One additive migration, all columns nullable, no enum change and therefore no
backfill and no downtime concern:

```
ALTER TABLE call_attempts          ADD COLUMN scored_at   timestamptz;
ALTER TABLE guardrail_violations   ADD COLUMN reviewed_at timestamptz;
ALTER TABLE guardrail_violations   ADD COLUMN reviewed_by uuid REFERENCES employees(id);
ALTER TABLE qualification_criteria ADD COLUMN options     text;
```

Existing seeded attempts have `scored_at = null`, which reads as "never scored"
rather than "stale" — the portal must distinguish the two. The seed must fill
`options` for the two enum criteria (`purchase_timeline`, `roof_type`), since an
active enum criterion without a vocabulary blocks extraction. Rollback is
dropping the four columns; no data written before them is lost.

Environment: a Google AI Studio key (`GOOGLE_GENERATIVE_AI_API_KEY`, free, no
card) plus the model id variables and `SCORING_WORKER_SECRET` must be added to
`apps/web/.env.example`, `apps/web/.env.local` and the Vercel project settings
before the worker runs.

## Open Questions

- The exact Gemini Flash model id is preview-stage and must be verified against
  the live model list at implementation time, then recorded in `.env.example` —
  not hardcoded.
- Whether extraction and the guardrail judge should share one model call over
  the same transcript. Kept separate for now so a judge failure cannot lose the
  answers, but if free-tier request limits bite, merging them is the first lever
  to pull.
