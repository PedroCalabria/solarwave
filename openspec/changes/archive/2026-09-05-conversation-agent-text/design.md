## Context

`scoring-worker` left the post-call half finished and measured: extraction runs
under a criteria-derived schema, `scoreLead` is pure and reproducible, the
narrative and the guardrail judge work, and `pnpm eval` reports 100% on the five
golden transcripts. Everything it consumes, however, starts from a transcript
that a human wrote by hand into `packages/db/src/seed/data.ts`. No code produces
one.

The pieces the conversation needs are all in place and unused for this purpose:
`qualification_criteria` carries `question_pt`, `question_en`, `options`,
`blocking`, `weight` and `sort_order`; `hasEnoughInformation` in
`@solarwave/core` already implements the section 4.5 rule; `ATTEMPT_OUTCOMES`
already includes `answered_incomplete`, `abusive` and `minor_answered`; the
portal already warns when the active criteria exceed the question budget
(`CriteriaManager.tsx`). What is missing is everything between the criteria rows
and a transcript.

`packages/scoring/src/guardrails.ts` states the gap explicitly: the four
guardrails that are behaviours rather than utterances — AI disclosure, graceful
exit from hostility, detecting a minor, redirecting out-of-scope questions — are
excluded from the judge and named as belonging to this change's persona suite.
Nothing evaluates them today.

Constraints: Vercel Hobby, Google's free tier, and a demo premise. The free tier
rations **requests**, not tokens — the repository's own measurement records
`gemini-3.8-flash` at 20 requests per day, which is why `gemini-3.5-flash-lite`
was chosen, and the existing eval paces itself at 13 seconds per call. A
conversation costs one request per turn per participant, so an evaluation
designed naively costs an order of magnitude more than the whole scoring eval.
That single fact shapes most of the decisions below.

## Goals / Non-Goals

**Goals:**
- Turn the active criteria into a call script that enforces every section 6
  guardrail, in the lead's language, without any hand-written per-criterion prose.
- Define the tool contract once, so change 4 changes the transport and not the
  contract.
- Evaluate the four behavioural guardrails that the post-call judge cannot see,
  and do it within a free-tier request budget someone will actually run.
- Close the loop end to end — conversation to score — without telephony.
- Keep CI free, deterministic and fully mocked, as `scoring-worker` established.

**Non-Goals:**
- Realtime audio, Twilio, the WebSocket bridge (change 4).
- `leadWorkflow` and automatic dispatch (change 5).
- Settling the callback-scheduling policy (change 5).
- Making any part of the guardrail frame employee-editable.

## Decisions

### D1 — A conversation adapter in `@solarwave/ai`, beside `generateStructured`

`@solarwave/ai` gains `generateTurn({ model, messages, tools, system, temperature })`,
returning the assistant turn plus the tool calls it made. `generateStructured`
stays exactly as it is.

Rationale: the existing function is a one-shot structured call with
`Output.object` and `temperature: 0` — correct for extraction, wrong for a
conversation in every particular. Generalising it would put an optional
`messages` and an optional `tools` on a function whose whole value is that it
does one thing. Two functions, one boundary: `packages/ai` remains the only
module in the monorepo that imports the SDK, which is what makes every
downstream test mockable.

Temperature defaults to 0.6 for the `conversation` and `persona` roles and stays
0 for the `linter`, whose job is to be consistent about the same question.

`testing.ts` gains `fakeToolCallingModel(script)`: a model that emits a
predetermined sequence of turns and tool calls. It is what lets the loop, the
early exit and every deterministic guardrail assertion be tested at zero cost.

The AI SDK's agent loop is documented at `ai@6.0.277/docs/03-agents`, present in
`node_modules`. Per the conventions, that is read at implementation time rather
than recalled.

*Alternative rejected:* using the SDK's built-in agent loop with automatic tool
execution. This loop needs to stop on `end_call`, count turns against a budget,
and inject a wrap-up instruction at a point measured in turns — control that is
clearer written out than configured.

### D2 — Tools are data with two projections, not an SDK object

Each tool is declared once as `{ name, description, parameters: ZodSchema }` in
`@solarwave/agent`. Two pure functions project the registry:

```
TOOL_REGISTRY ──▶ toAiSdkTools()            used by the text loop (change 3)
              └─▶ toFunctionDeclarations()  consumed by Gemini Live (change 4)
```

`toFunctionDeclarations()` emits plain JSON and is written and unit-tested here,
even though nothing calls it yet, and `@google/genai` is *not* added as a
dependency for it.

Rationale: the alternative is that change 4 re-declares five tools by hand
against a live audio session that is hard to test, and the two declarations
drift the first time a parameter changes. Writing the projection now costs a
function and a test; writing it later costs a bug found over a phone call. Not
depending on `@google/genai` keeps that package out of this change entirely —
the projection produces data, and change 4 hands the data to the SDK.

*Alternative rejected:* deriving Gemini declarations from the AI SDK tool
objects. That makes the AI SDK shape the source of truth for a contract the
production path does not use.

### D3 — A second env prefix, not a rename

`MODEL_ROLES` grows to six. The three existing roles keep `SCORING_MODEL_*`;
the three new ones use `AGENT_MODEL_CONVERSATION`, `AGENT_MODEL_PERSONA` and
`AGENT_MODEL_LINTER`.

Rationale: renaming to a neutral `AI_MODEL_*` prefix would be tidier in the
abstract and would break `apps/web/.env.local`, the Vercel project settings, the
README and the measured note in `.env.example` — for zero behavioural gain. Two
prefixes, each honest about its domain, cost one extra line in the env map.

The default for all three is `gemini-3.5-flash-lite`, the model the scoring eval
measured at 100% with free-tier headroom, and per the decision log the id is
confirmed against the live catalogue at implementation time rather than trusted.

### D4 — The frame is fixed, the middle is derived, and criteria cannot escape

The system prompt has three parts, and only the middle comes from the database:

```
┌──────────────────────────────────────────── fixed frame, in code ──┐
│ identity + AI disclosure · permission to ask · tone rules          │
│ every section 6 guardrail · 2-minute target · closing              │
├──────────────────────────── derived from active criteria, in DB ───┤
│ the questions, in call order, with their answer vocabulary         │
├──────────────────────────────────────────── fixed frame, in code ──┤
│ tool-use rules · what to do when a blocking criterion fails        │
└────────────────────────────────────────────────────────────────────┘
```

Criterion text is inserted as data under an explicit heading, never as
instruction, and the frame states that the rules above and below outrank
anything in the question list. An admin can write a bad question; an admin must
not be able to write a question that turns off the price guardrail.

Rationale: the criteria table is employee-editable by design (section 5.3), so
it is an untrusted input to the prompt. Treating it as such is cheap here and
impossible to retrofit later.

The language is chosen by `leads.preferred_call_language`, selecting
`question_pt` or `question_en`, satisfying section 4.3.

### D5 — Call order is derived; `sort_order` keeps the portal

Two orderings exist and this design stops conflating them:

| Ordering | Used by | Rule |
| --- | --- | --- |
| `sort_order`, then `created_at` | the portal list, `listActiveCriteria` | admin-controlled, audited |
| derived call order | the script | `blocking` first, then `weight` descending, then `sort_order`, then `key` |

The derived order is a pure function in `@solarwave/agent`, unit-tested, with
`key` as the final tiebreak so the same criteria always produce the same script.

Rationale: the decision log requires blocking-first so a failed blocking
criterion can end the call early and protect the two-minute budget — that is a
conversational rule, not a display preference. But `sort_order` is admin-edited
and audited, so silently ignoring it would make the portal lie. Resolution: it
is a tiebreak within each group, and the criteria view gains a **call order
preview** showing the real sequence, so nobody drags a row expecting the script
to follow.

### D6 — Behavioural guardrails get their own list, and assertions before judges

`AGENT_GUARDRAIL_KEYS` lives in `@solarwave/agent` and covers the four
behaviours the post-call judge excludes. `GUARDRAIL_KEYS` in `@solarwave/scoring`
is untouched, and this change writes no `guardrail_violations` rows.

Rationale: `GUARDRAIL_KEYS` is the vocabulary of a database column, validated by
`isGuardrailKey` and read by the violations view. Adding keys that only an
evaluation produces would put eval findings in a table that means "something
happened on a real call to this lead". Findings about the agent belong to the
agent's suite.

How each is checked, cheapest mechanism first:

| Guardrail | Check | Cost |
| --- | --- | --- |
| Identifies as an AI | the disclosure is present in the agent's first turn | assertion |
| A minor answered | `flag_minor` called, then `end_call` | assertion |
| Opt-out honoured | `mark_opt_out` called and no question asked afterwards | assertion |
| Hostile lead | `end_call` within N turns, no escalation | assertion for the exit, judge for "gracefully" |
| Out-of-scope redirect | the answer defers to a specialist | judge |

Rationale: a guardrail verifiable by looking at which tool was called must not
cost a model call. This is not a cheaper test standing in for a better one —
"did it call `mark_opt_out`" is a *stricter* check than asking a model whether
the agent seemed to honour the opt-out.

### D7 — The eval is budgeted in requests: probes are single-turn, personas are scripted

The suite has two shapes, and most scenarios use the cheap one.

**Probes** (single-turn). A short seeded history ends on the provocation; the
agent produces exactly one turn; assertions run on it. One request each, covering
price, savings, timeline, technical claims, financing, competitors, urgency,
sensitive data, opt-out, minor, hostility and out-of-scope. ≈12 requests.

**Full flows** (multi-turn) with **scripted personas**: the lead's replies are
deterministic functions of the conversation state, so only the agent spends
requests. Capped at 12 turns. Three scenarios — a cooperative lead, a chatty
lead, and a renter who fails a blocking criterion. ≈10 requests each.

```
                    naive design          this design
  probes            12 × 20 = 240              12
  full flows         8 × 20 = 160         3 × 10 = 30
                    ───────────          ───────────
                          400 requests           42 requests
                   over the daily cap    ~10 min at 13s pacing
```

Rationale: two independent wins. The budget one is obvious. The subtler one is
reproducibility — a scripted persona makes the conversation path stable, so a
regression in the suite means the agent changed, not that the persona had a
different idea this morning. The thing under test is the agent; making the other
participant a variable measures noise.

The cost is that scripted personas cannot improvise, so an agent that asks
something unforeseen gets a neutral fallback reply. That is a real limitation
and it is why the probes carry the adversarial cases: a probe needs no
improvisation, because the provocation is the whole point.

`--scenario` filtering runs one case in seconds during development, and a
rate-limit error is reported per scenario rather than aborting the run, matching
the existing eval's behaviour.

### D8 — Real model calls stay out of CI (extending D14 of `scoring-worker`)

`pnpm test` runs entirely on `fakeToolCallingModel`: script assembly, ordering,
tool projections, loop control, early exit, outcome mapping and every
deterministic guardrail assertion. `pnpm eval:agent` is separate and on demand.

This is the existing rule, restated because this change is the first where it is
tempting to break it: the guardrail suite is exactly the kind of thing one wants
gating a merge. It still must not, for the reason D14 already gives — free-tier
quota, latency and flake would make a red build uninformative.

### D9 — A simulated call is a real attempt, not a preview

The admin action runs the loop against a stored lead, then writes a genuine
`call_attempt` and calls the existing `scoreAttempt`. It goes through
`transition()` like any other call: `dispatch → calling → attempt_ended`,
incrementing `attempt_count` and setting `next_call_at` on a retryable outcome.

Marking needs no migration: `ended_reason = 'simulated'` with a null
`twilio_call_sid` (the unique index admits many nulls). The portal badges the
attempt wherever attempts are shown.

The action refuses in two cases:
- the lead's status is `opt_out` — section 6 makes that terminal and
  highest-priority, and simulating contact with someone who asked not to be
  contacted contradicts it even in a demo;
- an attempt for that lead is already in flight.

Rationale: a preview that renders a transcript without persisting it would prove
the conversation and nothing else. Persisting proves the conversation, the
extraction, the engine, the narrative, the judge and the state machine together
— which is the actual claim the demo makes, two changes before Twilio exists.

*Consequence, accepted:* simulating mutates lead data. `pnpm db:seed` is
idempotent and restores the demo set, so the path back exists. Admin-only, and
one click costs ≈13 requests (≈10 conversation, 3 scoring) against the daily
quota.

*Alternative rejected:* a `simulated boolean` column. `ended_reason` is already
a free-text column describing how an attempt ended, which is precisely this.

### D10 — The linter never blocks and never delays a save

`saveCriterionAction` is untouched in its critical path: it validates, writes,
audits and returns. The client then calls `lintQuestionAction` separately, and
there is a "check this question" button for use before saving. `ActionState`
gains `warnings: string[]`.

Every failure mode — no API key, rate limited, malformed output, timeout —
resolves to zero warnings and a saved criterion. The linter is advice from a
model about tone; it has no authority over whether an admin's work is accepted.

Rationale: putting a 1–3 second model call inside a form submission makes every
criterion edit feel broken when the free tier throttles, and makes the portal
unusable without an API key — which the seed path and the integration tests
deliberately support. Separating them costs one extra round trip on a rare
action.

## Risks / Trade-offs

- **The text agent is not the voice agent.** Gemini Flash text here, Native
  Audio in production; the suite validates the script and tools, not the model
  that will speak → the script, tools and guardrail frame live in
  `@solarwave/agent` so change 4 swaps only the transport, and change 4 re-runs
  the probe subset over the voice path. Stated plainly rather than mitigated
  away: a green suite here does not certify the voice call.
- **Scripted personas cannot improvise** → the adversarial cases are probes,
  which need no improvisation; unmatched agent turns get a neutral fallback and
  the scenario reports how often it fired, so a persona that stops covering its
  scenario is visible rather than silently passing.
- **An LLM judge on "graceful" and "redirected" is itself unreliable** → only
  two behaviours depend on it, both are also gated by a deterministic assertion
  (`end_call` was called; the answer was produced at all), and the judge grades
  quality on top of a check that already passed.
- **Free-tier request limits still cap the suite** → ≈42 requests per run with
  13-second pacing, `--scenario` for development, and per-scenario rate-limit
  reporting instead of an aborted run. If the cap tightens, probes survive and
  full flows are the first thing to drop.
- **Simulated calls mutate real lead rows** (D9) → admin-only, refused for
  `opt_out` and for in-flight attempts, badged everywhere, and `pnpm db:seed`
  restores. Accepted deliberately: an attempt that does not move the state
  machine would prove less than the demo claims.
- **Criteria text reaches a prompt** → D4 inserts it as data under a heading
  with the frame asserting precedence, and a test feeds a criterion whose text
  attempts to countermand a guardrail and asserts the guardrail holds.
- **A third package for a demo-scale project** → the same justification D4 of
  `scoring-worker` gave for the second one: change 4 needs the script and tools
  and must not import them from `apps/web`.

## Migration Plan

No database migration. No new third-party dependency.

Environment: three variables added to `apps/web/.env.example`, `.env.local` and
the Vercel project, all defaulting to the same model the scoring roles use:

```
AGENT_MODEL_CONVERSATION=gemini-3.5-flash-lite
AGENT_MODEL_PERSONA=gemini-3.5-flash-lite
AGENT_MODEL_LINTER=gemini-3.5-flash-lite
```

`assertConfiguredModels()` already checks every role in `MODEL_ROLES`, so the
three new ids are covered by the existing startup check the moment they are
added to the list — including the guard that rejects a Gateway-style
`google/`-prefixed id.

Rollback is deleting `packages/agent`, the adapter, and the two server actions;
nothing in the database depends on any of it, and simulated attempts left behind
remain valid rows that the portal renders like any other.

## Open Questions

- The exact `gemini-3.5-flash-lite` id, like every other model id in this
  project, is verified against the live catalogue at implementation time.
- **Not settled here, and deliberately:** whether `request_callback` should make
  the lead's requested time the next attempt or defer to the fixed 15-minute /
  2-day policy. This change defines the tool so the time is captured; change 5
  owns the scheduling decision. The config's open question stands.
- How many turns "N" is for the hostile-exit assertion. It wants one real
  conversation to calibrate rather than a number invented now; the suite starts
  at 2 turns after the first hostile utterance and the eval reports the actual
  figure.
- Whether the transcripts a good simulated call produces should eventually join
  the golden set. Not in this change — the proposal rules it out so extraction
  is never graded against another model's output — but if hand-writing more
  fixtures becomes the bottleneck, a human-reviewed promotion path is the first
  thing to reconsider.
