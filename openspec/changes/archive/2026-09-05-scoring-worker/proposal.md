## Why

Spec section 4.6 requires a scoring worker: after a call ends, a non-realtime
model reads the transcript, extracts structured answers, and the deterministic
criteria produce a score, a qualification reason and an icebreaker. Today the
deterministic half exists and is tested (`scoreLead` in `@solarwave/core`) and
the database has every column it needs (`call_attempts.transcript`,
`qualification_answers`, `guardrail_violations`, `settings`), but nothing
connects them: no LLM plumbing exists anywhere in the monorepo and
`guardrail_violations` has no writer and no reader.

This change is next because it de-risks the product without telephony. The seed
already holds 48 hand-written transcript turns with the expected answers per
criterion, so extraction quality can be measured today, before a single Twilio
minute is spent.

## What Changes

- **New `@solarwave/ai`**: thin, mockable adapters over the Vercel AI SDK,
  calling Google directly through `@ai-sdk/google`. The AI Gateway was tried
  first and rejected: it refuses every request, free credits included, until a
  payment method is on file. Model ids come from environment variables because
  the Gemini ids move fast.
- **New `@solarwave/scoring`**: the worker pipeline — extract answers, call the
  existing engine, generate the narrative, run the guardrail judge, persist
  everything in one transaction.
- **Enum criteria gain an `options` vocabulary**, separate from the
  `expected_value` pass rule the two were conflated into. The seeded data proves
  they differ: a lead answers `within_6_months` on a criterion that only passes
  `this_month|within_3_months`.
- **Extraction schema is generated from the active criteria**, not from the
  criterion type alone. An `enum` criterion constrains the model to exactly its
  `options`, so a lead saying "esse mês mesmo" is extracted as `this_month`
  instead of failing the rule silently — while an answer that fails stays
  expressible.
- **Guardrail judge** writes spec section 6 violations into
  `guardrail_violations` with a severity fixed per guardrail, not chosen by the
  model.
- **Opt-out belt-and-braces**: transcript evidence of an opt-out that the live
  agent missed raises a high-severity violation and clears `next_call_at`; it
  never writes the terminal `opt_out` status automatically.
- **Manual recomputation**: the portal detects that criteria or settings changed
  since a lead was scored and offers the correct action — a free pure re-score,
  or a transcript reprocessing that costs an LLM call. Nothing recomputes by
  itself.
- **Portal additions**: a guardrail violations view with a review action, a
  staleness banner with the recompute action, and extraction confidence and
  evidence on the lead detail.
- **Schema**: one additive migration of four nullable columns —
  `call_attempts.scored_at` (without it, staleness cannot be detected),
  `guardrail_violations.reviewed_at` / `reviewed_by` (a violation that blocks
  scheduling until reviewed needs a reviewed state), and
  `qualification_criteria.options` (the enum vocabulary).
- **Entry point**: `scoreAttempt(attemptId)` plus a protected
  `POST /api/internal/score`. This change does not build `leadWorkflow`; the
  workflow calls this function in change 5.
- **Housekeeping**: replace the seven `Purpose: TBD` placeholders left in
  `openspec/specs/*` by the previous archive.

### Deterministic vs LLM

| Deterministic (no model, unit-tested) | LLM call |
| --- | --- |
| `scoreLead`: score, decision, blocking, enough-information | Answer extraction from the transcript |
| Extraction JSON schema generation from active criteria | Reason and icebreaker (one combined call) |
| Staleness classification from `criteria_audit_log` | Guardrail judge |
| Guardrail severity mapping | |
| Persistence, upsert and retry policy | |

The boundary of reproducibility is the persisted answer, not the transcript.
Two leads with identical answers, criteria and threshold always produce an
identical score; re-running extraction over the same transcript may not produce
identical answers, which is exactly why recomputation is an explicit,
human-triggered event.

## Capabilities

### New Capabilities
- `answer-extraction`: turning a transcript into typed, evidence-backed answers
  under a criteria-derived schema, and the `scoring_status` lifecycle
  (`pending` → `running` → `done` | `failed`) with idempotent retries.
- `qualification-narrative`: the qualification reason and the icebreaker, in
  the lead's call language, from one model call.
- `guardrail-audit`: the post-call judge over the text-detectable guardrails of
  spec section 6, severities, the opt-out safety net and the review workflow.
- `score-recomputation`: detecting that a scored lead is stale, classifying the
  change into a pure re-score or a transcript reprocessing, and running it on
  demand.

### Modified Capabilities
- `lead-lifecycle`: settles the open question of the intermediate state. A lead
  stays `calling` while scoring runs — no `scoring` status is added — and a
  failed scoring never moves the lead.
- `lead-portal`: the lead detail surfaces confidence, evidence and the
  staleness banner; a new violations view exists; the dashboard reflects
  scoring pendings.
- `criteria-management`: criteria gain the `options` vocabulary, with validation
  that `expected_value` is a subset of it and that non-enum criteria have none.

## Impact

- **New packages**: `packages/ai`, `packages/scoring`.
- **New dependencies**: `ai` (Vercel AI SDK) and `@ai-sdk/google@3.0.121`,
  pinned because `@ai-sdk/google@4` needs a newer provider spec than `ai@6.0.277`
  resolves. Requires a free Google AI Studio key, documented in
  `apps/web/.env.example`.
- **Migration**: one additive migration, four nullable columns. No pgEnum change,
  so `LEAD_STATUSES` and the portal `STATUS` map are untouched.
- **`@solarwave/db`**: new queries for attempts, answers upsert, violations and
  staleness. `applyLeadTransition` already accepts `score`,
  `qualificationReason` and `icebreaker` in its patch and needs no change.
- **`apps/web`**: one internal route, two portal views, one server action for
  recomputation.
- **Spec sections touched**: 4.5 (enough information), 4.6 (scoring worker),
  4.7 (persistence), 5.2 and 5.3 (portal), 6 (all guardrails), 10 (retention,
  via the expired-transcript case).
- **Free-tier constraints**: the Vercel AI Gateway is unusable without a card on
  file, so text calls go to Google directly; its free tier has per-minute
  request limits, which caps how fast a bulk reprocessing can run, and its terms
  allow Google to use content to improve their products. The 12-month transcript
  purge of section 10 makes reprocessing permanently impossible for old attempts.

## Non-goals

- **The question linter** on criterion save. Deferred to
  `conversation-agent-text` (change 3), which owns prompt authoring.
- **`leadWorkflow`**, Twilio, and any real call trigger. Changes 4 and 5.
- **Adding a `scoring` lead status.** Explicitly rejected; see design.
- **Automatic recomputation** on criteria change. Rejected in favour of an
  explicit action, so an employee editing a weight never silently rewrites the
  scores of the whole base.
- **Confidence affecting the score.** Confidence is recorded and displayed but
  the engine ignores it; a hesitant model must not trigger extra phone calls.
- **Realtime audio, voice prompts, and the live `record_answer` tool.** The
  worker reads only the stored transcript.
- **Storing call audio.** Forbidden by spec section 10.
