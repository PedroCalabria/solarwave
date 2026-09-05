## ADDED Requirements

### Requirement: The realtime session is configured from the assembled script and the shared tool registry
The voice session SHALL open a realtime model session configured with the system
prompt produced by the existing script assembly for the lead's call language, and
with the function declarations produced by the existing tool registry projection
for the criterion keys of that script. It SHALL NOT declare tools of its own and
SHALL NOT hand-write conversational prose.

#### Scenario: The session prompt is the assembled script
- **WHEN** a voice session starts for a lead whose call language is `pt`
- **THEN** the session is configured with the Portuguese assembled script and no other system text

#### Scenario: Tools come from the registry projection
- **WHEN** a voice session starts
- **THEN** the declared functions are exactly the five registry tools, and `record_answer` accepts only the criterion keys of the assembled script

### Requirement: The agent identifies itself as an AI before asking anything
The session SHALL cause the agent to speak first, and its first utterance SHALL
be the AI disclosure, before any qualification question is asked and without
waiting for the lead to speak.

#### Scenario: Disclosure precedes the first question
- **WHEN** a voice session begins and the lead has said nothing
- **THEN** the agent speaks the AI disclosure as its first utterance, and no criterion question precedes it

### Requirement: The transcript is captured from input and output transcription
The session SHALL build the call transcript from the model's input and output
transcription, as an ordered list of turns each attributed to `ai` or `lead`, in
the same shape a simulated call writes. Consecutive fragments from the same
speaker SHALL be accumulated into one turn, and a turn SHALL be closed when the
speaker changes or the session ends. Call audio SHALL NOT be written anywhere.

#### Scenario: Fragments accumulate into turns
- **WHEN** the model emits three output transcription fragments followed by a lead transcription fragment
- **THEN** the transcript contains one `ai` turn holding the three fragments and one `lead` turn

#### Scenario: No audio is persisted
- **WHEN** a call completes
- **THEN** the persisted attempt carries a transcript and no audio in any form

### Requirement: The call is bounded by a wrap-up instruction and a hard stop
The session SHALL inject a wrap-up instruction at the configured wrap-up time,
instructing the agent to close courteously on its next turn, and SHALL end the
call at the configured hard stop whether or not the agent has closed. Both
durations SHALL be configurable, and the hard stop SHALL be strictly less than
the platform's function duration limit so the budget is enforced by the system
rather than discovered as a disconnection.

#### Scenario: Wrap-up is injected once
- **WHEN** a call reaches the configured wrap-up time and is still open
- **THEN** the agent receives the wrap-up instruction exactly once

#### Scenario: The hard stop ends an unclosed call
- **WHEN** a call reaches the configured hard stop and the agent has not called `end_call`
- **THEN** the session ends the call and reports the end reason `incomplete`

#### Scenario: Enough information ends the call early
- **WHEN** every active blocking criterion is answered and the configured share of active weight is answered
- **THEN** the wrap-up instruction is injected without waiting for the wrap-up time

### Requirement: Tool calls drive the call, and the shared policy decides the outcome
The session SHALL interpret every tool call the model makes, recording answers,
capturing a requested callback time, flagging a minor and honouring an opt-out.
It SHALL resolve how the call ended into an attempt outcome using the same
transport-neutral mapping the text conversation uses, so a text call and a voice
call that end for the same reason produce the same outcome. The session SHALL
return every tool call a result, so the model can see its own calls and does not
reissue them.

#### Scenario: A recorded answer is kept
- **WHEN** the model calls `record_answer` for a criterion in the script
- **THEN** the answer is retained for the attempt and the model receives a result for the call

#### Scenario: Text and voice agree on the outcome
- **WHEN** a call ends with the reason `blocking_failed`
- **THEN** the resolved outcome is the same one the text conversation resolves for that reason

#### Scenario: Every tool call receives a result
- **WHEN** the model issues a tool call
- **THEN** a result for that call is sent back before the next agent turn

### Requirement: Opt-out during a voice call is immediate and outranks everything
When the model calls `mark_opt_out`, the session SHALL treat the call as ending
for opt-out regardless of any other end reason the model states, SHALL let the
agent close courteously, and SHALL report the opt-out so the attempt is recorded
with outcome `opt_out` and the lead reaches the terminal `opt_out` status. This
SHALL take priority over an unanswered blocking criterion, over the wrap-up, and
over the hard stop.

#### Scenario: Opt-out overrides a stated end reason
- **WHEN** the model calls `mark_opt_out` and then `end_call` with reason `enough_information`
- **THEN** the reported end reason is opt-out and the attempt outcome is `opt_out`

#### Scenario: Opt-out mid-question
- **WHEN** the lead asks not to be contacted again while a criterion question is unanswered
- **THEN** the call ends for opt-out and the remaining questions are not asked

### Requirement: A minor answering ends the voice call, and a hostile lead ends it without escalation
When the model calls `flag_minor` the session SHALL end the call and report the
minor end reason, so the attempt is recorded as `minor_answered` and retried per
policy. When the model ends the call with the hostile reason the session SHALL
end it without escalation, so the attempt is recorded as `abusive` and the lead
is disqualified without a retry.

#### Scenario: A minor answers the phone
- **WHEN** the model calls `flag_minor` during a voice call
- **THEN** the call ends politely and the attempt outcome is `minor_answered`

#### Scenario: A hostile lead
- **WHEN** the model ends the call with the hostile reason
- **THEN** the call ends without argument and the attempt outcome is `abusive`

### Requirement: The session publishes its state durably rather than holding it
The session SHALL persist the transcript it has accumulated and the end reason it
has resolved to the attempt row as the call proceeds, not only when the call
ends, so that a session that terminates unexpectedly does not take the
conversation with it. Persistence SHALL be throttled and SHALL overwrite the
attempt's transcript rather than appending duplicate rows.

#### Scenario: A session that dies mid-call leaves the conversation behind
- **WHEN** a session terminates without reaching the end of the call
- **THEN** the attempt row still carries the turns transcribed before it terminated

#### Scenario: Persistence is throttled
- **WHEN** twenty transcription fragments arrive within one second
- **THEN** fewer than twenty writes are made and the attempt's transcript reflects the latest state
