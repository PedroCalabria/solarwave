## ADDED Requirements

### Requirement: A browser harness exercises a real voice session without telephony
The system SHALL provide an admin-only harness that opens the same realtime voice
session the telephone path uses, driven by the browser's microphone and speakers,
with no telephony provider involved. It SHALL use the same assembled script, the
same tool declarations, the same timers and the same end-reason resolution, so a
behaviour verified in the harness is the behaviour the phone path runs.

#### Scenario: A full conversation with no telephony
- **WHEN** an admin starts a harness session and speaks into the microphone
- **THEN** the agent replies with audio, the transcript accumulates, and no telephony provider is contacted

#### Scenario: The harness shares the session with the phone path
- **WHEN** the harness runs against a chosen call language and criteria set
- **THEN** the system prompt and function declarations are the ones the telephone path would use for the same language and criteria

### Requirement: A harness session never writes a lead attempt
A harness session SHALL NOT create or modify a `call_attempts` row, SHALL NOT
change a lead's status, and SHALL NOT trigger scoring. Its transcript SHALL be
shown to the operator and discarded when the session ends.

#### Scenario: No trace in the database
- **WHEN** a harness session completes
- **THEN** no attempt row was created, no lead status changed, and no scoring ran

### Requirement: The harness shows what the agent did, not only what it said
The harness SHALL display the running transcript and every tool call the model
made, with its arguments, and the resolved end reason when the session ends, so
an operator can see that a guardrail fired rather than inferring it from the
audio.

#### Scenario: A tool call is visible
- **WHEN** the model calls `record_answer` during a harness session
- **THEN** the harness shows the tool name and its arguments alongside the transcript

#### Scenario: The end reason is shown
- **WHEN** a harness session ends
- **THEN** the harness shows the resolved end reason and the outcome it would map to

### Requirement: The harness is admin-only and states its cost
The harness SHALL be reachable only by an employee with the admin role, and SHALL
state that it consumes realtime model quota, so an operator understands that a
session is not free even though it places no call.

#### Scenario: An agent-role employee cannot open a session
- **WHEN** an employee with the `agent` role opens the harness
- **THEN** the session is refused
