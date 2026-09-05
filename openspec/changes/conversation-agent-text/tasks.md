## 1. Model roles and the conversation adapter

- [ ] 1.1 Add `conversation`, `persona` and `linter` to `MODEL_ROLES` in `packages/ai/src/env.ts` under the `AGENT_MODEL_*` prefix, leaving the three `SCORING_MODEL_*` variables untouched (design D3); extend the env-var unit tests, including the existing guard that rejects a `google/`-prefixed id
- [ ] 1.2 Document the three new variables in `apps/web/.env.example` and add them to `.env.local` and the Vercel project, defaulting to the model the scoring roles already use; confirm the id against the live catalogue first rather than trusting it
- [ ] 1.3 Implement `generateTurn({ model, system, messages, tools, temperature, maxRetries, abortSignal })` in `packages/ai/src/generate.ts` (or a sibling module), returning the assistant turn and the tool calls it made, reusing `toAiError` so the error taxonomy stays single-sourced (design D1). Read `ai@6.0.277/docs/03-agents` first
- [ ] 1.4 Add `fakeToolCallingModel(script)` to `packages/ai/src/testing.ts`: a model emitting a predetermined sequence of turns and tool calls, recording what it was sent
- [ ] 1.5 Unit-test `generateTurn` against the fake and the failing model: tool calls surfaced, message history passed through, temperature honoured, and each error kind classified

## 2. `@solarwave/agent` and script assembly

- [ ] 2.1 Scaffold `packages/agent` (package.json, tsconfig, vitest config) depending on `@solarwave/ai`, `@solarwave/core` and `@solarwave/db`, and register it in the workspace
- [ ] 2.2 Implement the derived call order — `blocking`, then descending `weight`, then `sort_order`, then `key` — as a pure function, with unit tests covering each tiebreak level and repeat-stability (design D5)
- [ ] 2.3 Write the fixed frame in both languages: identity and AI disclosure, permission to ask, tone rules, every section 6 guardrail, the two-minute target, the closing, the tool-use rules and the failed-blocking-criterion instruction (design D4)
- [ ] 2.4 Implement `buildCallScript({ criteria, language, settings })` inserting criterion questions as data under an explicit heading, with the frame asserting precedence over anything in that list; expose the question count for the portal budget
- [ ] 2.5 Unit-test assembly: active criteria present once each, inactive absent, `question_pt`/`question_en` chosen by language, guardrails present in every assembly, and a criterion whose text tries to countermand the price guardrail leaves the guardrail intact
- [ ] 2.6 Unit-test that enum criteria carry their `options` vocabulary into the script, reusing `parseOptionList` from `@solarwave/core` so the script and the extraction schema cannot disagree

## 3. Tool registry and projections

- [ ] 3.1 Declare the five tools once as data — `record_answer`, `request_callback`, `mark_opt_out`, `flag_minor`, `end_call` — with zod parameter schemas, constraining `criterion_key` to the keys of the criteria in the assembled script
- [ ] 3.2 Implement `toAiSdkTools()` and `toFunctionDeclarations()` over the registry, the latter emitting plain JSON without depending on `@google/genai` (design D2)
- [ ] 3.3 Unit-test that both projections expose the same tool names and the same parameter names, so adding a parameter to the registry reaches both without a separate edit

## 4. The conversation loop

- [ ] 4.1 Implement the loop: assemble the script, offer the tools, run turns against `generateTurn`, and accumulate the transcript in the `TranscriptTurn` shape the extraction and judge steps already consume
- [ ] 4.2 Track `record_answer` calls and end the call early once `hasEnoughInformation` from `@solarwave/core` is satisfied, treating live answers as advisory only (design D2, agent-tools spec)
- [ ] 4.3 Implement the turn cap and the wrap-up instruction injected before it, and end the call politely when a blocking criterion is answered and fails
- [ ] 4.4 Map a finished conversation to an `AttemptOutcome`: `answered_complete`, `answered_incomplete`, `opt_out`, `abusive`, `minor_answered`; unit-test every branch against `fakeToolCallingModel`
- [ ] 4.5 Unit-test that `mark_opt_out` ends the call immediately, that no question follows it, and that it outranks an unanswered blocking criterion

## 5. Question linter

- [ ] 5.1 Implement the linter in `packages/agent`: a structured call over `question_pt` and `question_en` returning warnings that name the concern and the question, covering tone, asking the lead to justify a negative answer, and conflicts with the section 6 guardrails
- [ ] 5.2 Make every failure path resolve to zero warnings — no API key, rate limited, unparseable output, timeout — and unit-test each one (design D10)
- [ ] 5.3 Unit-test the flagged cases against fakes: a judgemental question, a sensitive-data collision, a financial-advice collision, and a neutral question producing nothing

## 6. Portal: warnings, call order and linting

- [ ] 6.1 Add `warnings: string[]` to `ActionState` in `apps/web/src/app/portal/(shell)/criteria/state.ts`, leaving `saveCriterionAction` free of any model call
- [ ] 6.2 Add `lintQuestionAction`, called by the client after a successful save and by a "check this question" control before saving; render warnings distinctly from field errors
- [ ] 6.3 Add the call order preview to the criteria view, showing the sequence the agent will actually ask the active criteria, next to the existing question budget warning

## 7. Simulated calls

- [ ] 7.1 Add a `@solarwave/db` query creating a simulated attempt with `ended_reason = 'simulated'` and a null `twilio_call_sid`, and integration-test it on the PGlite harness
- [ ] 7.2 Implement `simulateCall(leadId)` in `packages/agent`: run the loop for the lead's language, persist the attempt, apply `dispatch` and `attempt_ended` through `transition()`, and call the existing `scoreAttempt` (design D9)
- [ ] 7.3 Enforce the refusals — lead status `opt_out`, an attempt already in flight — writing nothing on refusal, with unit tests for both
- [ ] 7.4 Integration-test the transitions per outcome: complete answered qualifies or disqualifies, incomplete moves to `waiting_retry` with `next_call_at` inside the window, hostile disqualifies without retry, opt-out is terminal and clears `next_call_at`
- [ ] 7.5 Add the admin-only `simulateCallAction` to the lead detail with the refusal reason rendered in place, and hide the control for the `agent` role
- [ ] 7.6 Badge simulated attempts wherever attempts are displayed in the portal

## 8. Persona evaluation suite

- [ ] 8.1 Build the probe harness: a seeded history ending on a provocation, one agent turn requested, assertions on that turn — one model request per probe (design D7)
- [ ] 8.2 Write the twelve probes covering prices and savings, timelines, technical claims, financial advice, competitors, urgency, sensitive data, opt-out, minor, hostility and out-of-scope redirection
- [ ] 8.3 Implement scripted personas as deterministic functions of conversation state, with a neutral fallback reply and a fallback counter reported per scenario
- [ ] 8.4 Write the three full-flow scenarios — cooperative lead, chatty lead, renter failing a blocking criterion — capped at the configured turn count
- [ ] 8.5 Implement the deterministic guardrail assertions: disclosure in the first turn, `flag_minor` plus `end_call`, `mark_opt_out` with no question after it, and `end_call` within N turns of the first hostile utterance (design D6)
- [ ] 8.6 Implement the judge pass for the two behaviours no assertion can check — graceful hostile exit and out-of-scope redirection — running only after the corresponding assertion has passed
- [ ] 8.7 Write `pnpm eval:agent` with `--scenario` filtering, the existing 13-second pacing and `EVAL_DELAY_MS` override, per-scenario rate-limit reporting that does not abort the run, and a summary of guardrails, turn counts and fallback counts
- [ ] 8.8 Run the full suite once against the real model, record the measured request count and the calibrated hostile-exit turn count in `.env.example` or the design's open questions, and fix whatever the run exposes

## 9. Verification and documentation

- [ ] 9.1 Confirm `pnpm test` passes with no API key configured, proving CI stays mocked and free (design D8)
- [ ] 9.2 Run `pnpm typecheck` and `pnpm lint` across the workspace
- [ ] 9.3 Update the README: the new package in the layout, the `eval:agent` and simulate entries in the scripts table, and the state-of-the-build section
- [ ] 9.4 Update `openspec/config.yaml`: repository state, the settled decisions of this change, and the note that `request_callback` captures a time while the scheduling policy stays open for change 5
