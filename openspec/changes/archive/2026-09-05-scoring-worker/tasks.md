## 1. Schema and environment

- [x] 1.1 Add `call_attempts.scored_at`, `guardrail_violations.reviewed_at`, `guardrail_violations.reviewed_by` and `qualification_criteria.options` to `packages/db/src/schema.ts`; run `pnpm db:generate` and review the generated SQL is additive and nullable
- [x] 1.2 Provision AI Gateway auth. The gateway default is OIDC via `npx vercel link` and `npx vercel env pull`, but its token expires in about 24 hours, which is friction for local seeds and evals; use the static `AI_GATEWAY_API_KEY` instead, which takes precedence over `VERCEL_OIDC_TOKEN` (design D13) — SUPERSEDED by group 11: the Gateway proved unusable without a card.
- [x] 1.3 Document `AI_GATEWAY_API_KEY`, the extraction/narrative/judge model id variables and `SCORING_WORKER_SECRET` in `apps/web/.env.example`, and add them to `.env.local` and the Vercel project — SUPERSEDED by group 11: the Gateway proved unusable without a card.
- [x] 1.4 Record the per-role model ids in `.env.example` using the design D12 defaults (`google/gemini-3.8-flash` for extraction, `google/gemini-3.5-flash-lite` for narrative and judge), re-reading the public catalogue at `GET https://ai-gateway.vercel.sh/v1/models` first to confirm they are still listed. Never hardcode a slug in source. This covers only the text models — the realtime voice model id comes from Google's own catalogue in change 4 — SUPERSEDED by group 11: the Gateway proved unusable without a card.

- [x] 1.5 Add the enum vocabulary primitives to `@solarwave/core`: a shared pipe-list parser plus validation that an enum criterion has at least two options and that `expected_value` is a non-empty subset of them, with unit tests (design D5)
- [x] 1.6 Enforce those rules in `createCriterion` and `updateCriterion`, add `options` to `AUDITED_FIELDS` so the recomputation classifier can distinguish it from `expected_value`, and fill vocabularies for the seeded `purchase_timeline` and `roof_type`
- [x] 1.7 Add the options field to the portal criteria form, shown only for enum criteria, with the subset error surfaced on the field

## 2. `@solarwave/ai` adapters

- [x] 2.1 Scaffold `packages/ai` (package.json, tsconfig, vitest config) and add `ai` as a dependency
- [x] 2.2 Implement the client factory reading model ids from env, with an injectable transport so tests never touch the SDK
- [x] 2.3 Implement `generateStructured(schema, prompt)` with retry and exponential backoff for transient and rate-limit errors, plus unit tests using a fake transport
- [x] 2.4 Add a recorded-response fake used by every downstream test, so CI never calls a real model
- [x] 2.5 Confirm the model id chosen in 1.4 against `gateway.getAvailableModels()` now that `ai` is installed, and fail fast at startup with a clear message when the configured id is not in the catalogue

## 3. Extraction schema generation (deterministic)

- [x] 3.1 Implement the schema generator in `packages/scoring` that maps active criteria to properties, reusing `parseExpectedValue` from `@solarwave/core`
- [x] 3.2 Make `enum` criteria emit the literals of their `options` vocabulary, never `expected_value`; unit-test that a lead answering `within_6_months` on a criterion that only passes `this_month|within_3_months` extracts that value and then fails
- [x] 3.3 Unit-test that inactive criteria are absent, and that a malformed `expected_value` or a missing enum vocabulary fails with a criterion-naming error before any model call
- [x] 3.4 Unit-test the `confidence` and `evidence` properties are required on every criterion property

## 4. The worker pipeline

- [x] 4.1 Scaffold `packages/scoring` (package.json, tsconfig, vitest config) depending on `@solarwave/core`, `@solarwave/db` and `@solarwave/ai`
- [x] 4.2 Implement `extractAnswers(transcript, criteria)` returning typed answers with confidence and evidence
- [x] 4.3 Implement the narrative call producing reason and icebreaker together in the lead's `preferred_call_language`, constrained by the section 6 content rules
- [x] 4.4 Implement `scoreAttempt(attemptId)`: load attempt, criteria and settings, extract, run `scoreLead`, generate the narrative, and write answers, score, decision, narrative and `scored_at` in one transaction
- [x] 4.5 Implement the `scoring_status` lifecycle (`running`, `done`, `failed`) with backoff, and make the answer write an upsert on `unique(call_attempt_id, criteria_id)`
- [x] 4.6 Ensure a failed run applies no lifecycle transition and never synthesises a decision; unit-test the lead is untouched
- [x] 4.7 Skip icebreaker generation for an opted-out lead or an attempt with an unreviewed high-severity opt-out violation

## 5. Guardrail judge

- [x] 5.1 Define the guardrail key constants and the fixed severity table for the seven text-detectable guardrails plus `opt_out_missed`
- [x] 5.2 Implement the judge call and discard any finding whose guardrail key is not in the table
- [x] 5.3 Persist findings to `guardrail_violations`, running independently of the scoring transaction so a judge failure cannot lose answers or the score
- [x] 5.4 Implement the opt-out safety net: high-severity `opt_out_missed` violation plus clearing `leads.next_call_at`, with a test asserting no code path writes status `opt_out` from a judge finding
- [x] 5.5 Unit-test one transcript fixture per judged guardrail, plus a clean transcript producing no rows

## 6. Recomputation (deterministic)

- [x] 6.1 Implement staleness detection comparing the newest `criteria_audit_log.changed_at` against `call_attempts.scored_at`, distinguishing never-scored from stale
- [x] 6.2 Implement the audit-field classifier returning pure re-score, reprocess, or no effect; unit-test every row of the design D9 table, including that an `expected_value` change is cheap while an `options` change is not
- [x] 6.3 Implement `rescoreAttempt(attemptId)` reading stored answers with no model call, and test it is idempotent
- [x] 6.4 Implement `reprocessAttempt(attemptId)` reusing the extraction path, refusing to run when the transcript is purged
- [x] 6.5 Add db queries for staleness and for listing attempts with `scoring_status = 'failed'`

## 7. Database queries

- [x] 7.1 Add `packages/db/src/queries/attempts.ts`: load an attempt with its lead, transcript and criteria snapshot
- [x] 7.2 Add the transactional answers upsert plus the score, narrative and `scored_at` write
- [x] 7.3 Add `packages/db/src/queries/violations.ts`: insert findings, list newest first with lead and attempt, mark reviewed, and query unreviewed high-severity violations per lead
- [x] 7.4 Add integration tests for the upsert idempotency and for the rollback on a mid-transaction failure

## 8. Entry point and portal

- [x] 8.1 Implement `POST /api/internal/score` guarded by the shared secret, returning the resulting `scoring_status`; test the 401 path
- [x] 8.2 Add the staleness banner to the lead detail with the two labelled actions and the purged-transcript case
- [x] 8.3 Show the evidence quote on each answer and mark low-confidence ones for review, keeping the criteria-driven order
- [x] 8.4 Build the guardrail violations view with the review action and the empty state
- [x] 8.5 Add scoring pendings to the dashboard with a retrigger action
- [x] 8.6 Add the server actions for re-score, reprocess, retrigger and review, restricted to authenticated employees

## 9. Evals and fixtures

- [x] 9.1 Extract the seeded transcripts and their hand-written expected answers into a golden fixture module shared by tests and evals
- [x] 9.2 Add a `pnpm eval` script that runs extraction against the real model and reports per-criterion accuracy
- [x] 9.3 Make the eval assert every `evidence` string is a literal substring of its transcript
- [x] 9.4 Add a judge eval over transcripts seeded with one deliberate violation of each judged guardrail
- [x] 9.5 Confirm `pnpm test` runs entirely on mocked adapters and makes no network call

## 10. Housekeeping

- [x] 10.1 Replace the seven `Purpose: TBD` placeholders in `openspec/specs/*/spec.md` with real purpose statements
- [x] 10.2 Update the repository-state and planned-changes sections of `openspec/config.yaml` (fixtures now live in `packages/db/src/seed/data.ts`, `packages/` is no longer empty, the intermediate-status open question is settled)
- [x] 10.3 Correct the LLM decisions section of `openspec/config.yaml`: text calls route through the Gateway where the catalogue reports `no_training: all`, so the training-data caveat applies only to the realtime call in change 4 (design D12b)
- [x] 10.4 Run `pnpm -r typecheck`, `pnpm -r lint` and `pnpm -r test`, then `openspec validate scoring-worker`

## 11. Move off the AI Gateway to the Google provider

The Gateway refuses every request until a card is on file, free credits
included, so the worker could not make a single model call. Recorded as tried
and reverted rather than rewritten away, because changes 3 and 4 need the same
finding.

- [x] 11.1 Pin `@ai-sdk/google@3.0.121`: it depends on `@ai-sdk/provider@3.0.15`, the same version `ai@6.0.277` uses, while `@ai-sdk/google@4` needs provider 4 and does not type against it
- [x] 11.2 Replace the gateway slugs with plain Google model ids and `AI_GATEWAY_API_KEY` with `GOOGLE_GENERATIVE_AI_API_KEY` in `packages/ai/src/env.ts` and `.env.example`
- [x] 11.3 Add a provider factory that turns a role into a `LanguageModel` through `createGoogle`, so nothing downstream changes shape
- [x] 11.4 Repoint the catalogue check at Google's `v1beta/models`, which unlike the Gateway's list needs the API key
- [x] 11.5 Rewrite design D12 (one catalogue, not two), delete D13 (no gateway auth choice left) and invert D12b (the `no_training: all` guarantee was the Gateway's and is gone)
- [x] 11.6 Update the proposal's Impact and the config decision log, restating the free-tier training caveat that D12b had declared resolved
- [x] 11.7 Run the real eval and record the measured extraction and judge accuracy — extraction 25/25 criteria and 18/18 verbatim evidence on `gemini-3.5-flash-lite`; judge 8/8 guardrails caught with 0 false positives on a clean call. Switched the extraction default off `gemini-3.8-flash`, whose free tier allows 20 requests per day
