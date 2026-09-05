## Why

Spec section 4.4 requires the agent to follow a structured qualification script
and enforce the section 6 guardrails throughout the call, and the decision log
commits to that script being assembled from the active criteria rather than
hand-written. Nothing assembles it today: `question_pt`, `question_en`,
`options`, `blocking` and `weight` are stored, audited and displayed, but no
code turns them into a prompt, no tool contract exists for the live agent, and
the four guardrails only a live agent can violate — identifying as an AI,
ending gracefully with a hostile lead, detecting a minor, redirecting
out-of-scope questions — are deliberately excluded from the post-call judge and
have no evaluation anywhere.

This change is next because it is the last one that de-risks the conversation
without spending telephony. The Twilio trial is roughly 35 two-minute calls, and
those minutes must be spent proving audio, not discovering that the agent quotes
a price when asked.

## What Changes

- **New `@solarwave/agent`**: the call script assembled from active criteria,
  the tool contract, the conversation loop and the persona evaluation suite.
- **The script is derived, not authored.** A fixed, non-editable frame carries
  the AI disclosure, permission to ask, tone rules, every section 6 guardrail
  and the closing. Active criteria fill only the middle, in the lead's call
  language, ordered blocking-first and then by descending weight.
- **Prompt ordering is separate from display ordering.** `sort_order` keeps
  driving the portal list; the script derives its own order so a failed blocking
  criterion can end the call early. The portal gains a preview of the actual
  call order so the two never silently disagree.
- **Tools are defined once, provider-neutral**: `record_answer`,
  `request_callback`, `mark_opt_out`, `flag_minor` and `end_call` are declared
  as data with two projections — AI SDK tools, used here, and Gemini Live
  function declarations, tested here and consumed by change 4.
- **`@solarwave/ai` gains a conversation adapter.** `generateStructured` is a
  one-shot structured call; a conversation needs message history, tools and loop
  control, with a temperature above zero for the agent and the persona.
- **Question linter** on criterion questions: an advisory model pass that warns
  about tone and guardrail conflicts. It never blocks a save and never delays
  one — the save writes first, the lint runs as a separate action, and any
  model failure leaves the criterion saved with no warnings.
- **Persona evaluation suite** covering every section 6 guardrail and the
  two-minute budget, split into cheap single-turn probes and a few full flows
  with scripted personas. It runs on demand, never in CI.
- **Simulated calls**: an admin action on the lead detail runs a full text
  conversation, writes a real `call_attempt` marked `ended_reason = 'simulated'`
  and runs the existing scoring worker over it. This closes
  conversation → transcript → extraction → score → narrative → judge two changes
  before telephony exists.
- **No migration.** Every column the change needs already exists; a simulated
  attempt is identified by `ended_reason` with a null `twilio_call_sid`.

### Deterministic vs LLM

| Deterministic (no model, unit-tested) | LLM call |
| --- | --- |
| Script assembly, ordering and question budget | The agent's conversational turns |
| Tool declarations and both provider projections | The simulated lead's turns, in the full-flow scenarios only |
| Loop control: turn cap, wrap-up point, early exit via `hasEnoughInformation` | The question linter |
| Guardrail assertions on disclosure, `flag_minor`, `mark_opt_out` and `end_call` | The judge, for the two behaviours no assertion can check: graceful hostile exit and out-of-scope redirection |
| Persona replies in the full-flow scenarios (scripted) | |
| Mapping a finished conversation to an `AttemptOutcome` | |

The evaluation deliberately spends assertions before it spends tokens: a
guardrail that can be checked by looking at which tool was called is checked
that way, so the model budget goes to the handful of behaviours that genuinely
need judgement.

## Capabilities

### New Capabilities
- `conversation-script`: assembling the system prompt from the fixed frame and
  the active criteria — language selection, call ordering, the question budget,
  and the guarantee that no criterion text can override the guardrail frame.
- `agent-tools`: the tool contract the live agent acts through, its per-tool
  semantics, and the requirement that one definition projects to both the AI SDK
  and Gemini Live without divergence.
- `question-linting`: the advisory pass over a criterion's questions for tone
  and guardrail conflicts, and its fail-open behaviour on every model error.
- `agent-evaluation`: the persona suite — probes, full flows, the four
  behavioural guardrails of section 6, the turn budget, and the rule that real
  model calls stay out of CI.
- `call-simulation`: running a text conversation against a stored lead,
  persisting it as a real attempt marked as simulated, and handing it to the
  scoring worker; plus the cases the action must refuse.

### Modified Capabilities
- `criteria-management`: saving a criterion may return advisory warnings that
  never block the write, and the criteria view exposes the derived call order
  alongside the `sort_order` list.
- `lead-portal`: the lead detail offers an admin-only simulated call and marks
  the resulting attempt as simulated wherever attempts are displayed.

## Impact

- **New package**: `packages/agent`. No new third-party dependency — it uses
  `ai`, `zod` and the existing workspace packages.
- **`@solarwave/ai`**: one new adapter for multi-turn tool-calling conversations
  and one new fake model for tests. `MODEL_ROLES` gains `conversation`,
  `persona` and `linter` under an `AGENT_MODEL_*` prefix; the existing
  `SCORING_MODEL_*` variables are left untouched, so no `.env.local` or Vercel
  project setting breaks.
- **`apps/web`**: one server action for linting, one for simulating a call, a
  warnings channel on the criteria action state, the call-order preview and the
  simulated-attempt badge.
- **`@solarwave/db`**: no schema change. One query to create a simulated attempt.
- **Migration**: none.
- **Spec sections touched**: 4.3 (prompt and guardrail set matching
  `preferred_call_language`), 4.4 (the structured script and the guardrails
  during the call), 4.5 (enough information and the incomplete-call outcome),
  4.6 and 4.7 (reached through a simulated attempt), 5.3 (criteria
  configuration), 6 (every guardrail, and the only coverage the four
  behavioural ones get), 7 (a simulated attempt drives real transitions).
- **Free-tier constraints**: the evaluation is designed around request count,
  not token count, because requests are what Google's free tier rations. Probes
  cost one request each and scripted personas halve the cost of a full flow, so
  a complete run is roughly 45 requests at the eval's existing 13-second pacing.
  A simulated call from the portal costs about 13 requests against the same
  daily quota. CI stays fully mocked and free.

## Non-goals

- **Realtime audio, Twilio, and the WebSocket bridge.** Change 4. This change
  produces the prompt and tools that change 4 transports; it does not transport
  them.
- **`leadWorkflow` and automatic call dispatch.** Change 5. A simulated call is
  triggered by a human clicking, never by a scheduler.
- **Settling the callback policy.** `request_callback` gets its contract here —
  it captures the time the lead asked for — but whether that time overrides the
  fixed 15-minute / 2-day retry stays an open question owned by change 5.
- **Extending `GUARDRAIL_KEYS` or writing `guardrail_violations` rows.** The
  four behavioural guardrails are evaluation findings about the agent, not audit
  rows about a lead's call, and the judge's table stays as it is.
- **Making the guardrail frame editable.** Employees configure criteria; they
  never edit the disclosure, the tone rules or the guardrails.
- **Automatic linting of the whole criteria set**, or blocking a save on a lint
  warning. The linter advises the admin in front of it, one criterion at a time.
- **Committing model-generated transcripts as golden fixtures.** The golden set
  stays hand-written, so extraction accuracy is never measured against another
  model's output.
- **Validating the voice model's behaviour.** The text agent runs on Gemini
  Flash text; the production conversation runs on Native Audio. The script and
  tools transfer, the model does not.
