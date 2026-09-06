# agent-tools Specification

## Purpose
The fixed set of tools the live agent acts through, declared once as data and projected to both the text SDK and the realtime provider. Covers what each tool means, that live answers are advisory while post-call extraction is authoritative, and the behavioural guardrails of spec section 6 that a tool call carries out: opt-out, a minor answering, and a hostile lead.
## Requirements
### Requirement: The agent acts through a fixed set of tools
The system SHALL define exactly five tools available to the live agent:
`record_answer(criterion_key, value)`, `request_callback(preferred_time)`,
`mark_opt_out()`, `flag_minor()` and `end_call(reason)`. The set SHALL be
declared once, as data, and SHALL NOT be assembled differently per call.

#### Scenario: Every tool is offered to the agent
- **WHEN** a conversation starts
- **THEN** all five tools are available to the model

#### Scenario: Criterion keys are constrained to the active criteria
- **WHEN** `record_answer` is declared for a call
- **THEN** its `criterion_key` parameter accepts only the keys of the criteria in the assembled script

### Requirement: One declaration projects to both providers
The tool registry SHALL expose a projection to AI SDK tools and a projection to
Gemini Live function declarations, both derived from the same source. The two
projections SHALL name the same tools with the same parameters, so the text path
and the voice path cannot diverge.

#### Scenario: Both projections describe the same tools
- **WHEN** both projections are generated from the registry
- **THEN** they contain the same tool names and the same parameter names for each tool

#### Scenario: Adding a parameter reaches both projections
- **WHEN** a parameter is added to a tool in the registry
- **THEN** both projections expose it without any separate edit

#### Scenario: The Gemini projection is plain data
- **WHEN** the function-declaration projection is generated
- **THEN** it is serialisable JSON and requires no realtime SDK to produce

### Requirement: Live answers are advisory and post-call extraction is authoritative
`record_answer` SHALL be used to drive the conversation — tracking what has been
answered and deciding when enough information exists — and SHALL NOT be the
source of the persisted qualification answers. The answers written for an attempt
SHALL come from post-call extraction over the transcript.

#### Scenario: Live and extracted answers disagree
- **WHEN** the agent recorded `monthly_bill = 500` during the call and extraction reads 450 from the transcript
- **THEN** the persisted answer is 450

#### Scenario: Live answers still drive the conversation
- **WHEN** `record_answer` has been called for every active criterion
- **THEN** the loop may end the call without waiting for extraction

### Requirement: Opt-out is immediate and terminal
When the lead asks not to be contacted again, the agent SHALL call
`mark_opt_out`, and the system SHALL treat the call as ending with outcome
`opt_out`. This takes priority over every other guardrail and over any remaining
question (spec section 6).

#### Scenario: Lead asks not to be contacted again
- **WHEN** the lead says "não me liguem mais"
- **THEN** `mark_opt_out` is called, the call ends, and the attempt outcome is `opt_out`

#### Scenario: No questions follow an opt-out
- **WHEN** `mark_opt_out` has been called
- **THEN** the agent asks no further qualification question

#### Scenario: Opt-out outranks an unanswered blocking criterion
- **WHEN** the lead opts out before the blocking criterion is asked
- **THEN** the call still ends immediately as `opt_out` and is not treated as incomplete

### Requirement: A minor answering ends the call and flags for retry
When the agent detects that a minor answered, it SHALL call `flag_minor` and end
the call. The attempt outcome SHALL be `minor_answered`, which retries per the
existing policy (spec section 6).

#### Scenario: A child answers the phone
- **WHEN** the lead's replies indicate a minor is speaking
- **THEN** `flag_minor` is called, the call ends, and the outcome is `minor_answered`

### Requirement: A hostile lead ends the call without escalation
When the lead becomes hostile or abusive, the agent SHALL call `end_call` with
that reason and SHALL NOT argue, insist or escalate. The attempt outcome SHALL be
`abusive` (spec section 6).

#### Scenario: Lead becomes abusive
- **WHEN** the lead insults the agent and demands it hang up
- **THEN** `end_call` is called with the hostile reason and the outcome is `abusive`

#### Scenario: The agent does not push back
- **WHEN** the lead is hostile
- **THEN** the agent's final turn contains no further question and no attempt to continue the script

### Requirement: A requested callback is captured, not scheduled
`request_callback` SHALL record the time the lead asked for. This change SHALL
NOT decide whether that time overrides the fixed retry policy; the tool captures
the intent and the scheduling decision belongs to the lifecycle change.

#### Scenario: Lead asks to be called later
- **WHEN** the lead says to call back after 18:00
- **THEN** `request_callback` records that preference and the call ends without promising a specific time

