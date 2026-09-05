## ADDED Requirements

### Requirement: A simulated call produces a real attempt
An admin SHALL be able to run a text conversation against a stored lead. The
system SHALL persist the result as a `call_attempts` row with the conversation as
its `transcript`, in the same shape a real call would write, and SHALL then run
the existing scoring worker over that attempt.

#### Scenario: Simulating a call scores the lead
- **WHEN** an admin simulates a call for a lead with no attempts
- **THEN** attempt 1 is created with a transcript, and the lead receives a score, a qualification reason and an icebreaker

#### Scenario: The transcript is usable by extraction
- **WHEN** a simulated conversation finishes
- **THEN** its transcript is stored in the same turn format the extraction and judge steps already consume

#### Scenario: Guardrail violations are judged as usual
- **WHEN** a simulated call breaks a text-detectable guardrail
- **THEN** the post-call judge writes the violation exactly as it would for a real call

### Requirement: Simulated attempts are marked and visible as such
A simulated attempt SHALL be identifiable without a schema change, by an
`ended_reason` of `simulated` and a null `twilio_call_sid`. The portal SHALL mark
it wherever attempts are displayed, so a simulated call is never mistaken for a
real one.

#### Scenario: The attempt carries the marker
- **WHEN** a simulated attempt is written
- **THEN** its `ended_reason` is `simulated` and its `twilio_call_sid` is null

#### Scenario: The portal badges it
- **WHEN** an employee views a lead with a simulated attempt
- **THEN** the attempt is labelled as simulated

### Requirement: A simulated call drives the real state machine
A simulated attempt SHALL apply lead transitions through the same state machine
as a real call: `dispatch` before it starts, `attempt_ended` with the mapped
outcome when it finishes, incrementing `attempt_count` and scheduling the next
attempt when the outcome is retryable.

#### Scenario: A complete answered call qualifies or disqualifies
- **WHEN** a simulated call gathers enough information and the score clears the threshold
- **THEN** the lead's status becomes `qualified`

#### Scenario: An incomplete call retries
- **WHEN** a simulated call ends before enough information is gathered
- **THEN** the outcome is `answered_incomplete`, the lead becomes `waiting_retry` and `next_call_at` is set within the call window

#### Scenario: A hostile lead is disqualified without retry
- **WHEN** a simulated call ends with the lead hostile
- **THEN** the outcome is `abusive` and the lead's status becomes `disqualified`

#### Scenario: An opt-out is terminal
- **WHEN** a simulated call ends with the lead asking not to be contacted again
- **THEN** the outcome is `opt_out`, the lead's status becomes `opt_out` and `next_call_at` is cleared

### Requirement: Simulation is admin-only and refuses unsafe cases
The action SHALL be available only to employees with the `admin` role, and SHALL
refuse to run when the lead's status is `opt_out` or when an attempt for that lead
is already in flight. A refusal SHALL explain why and SHALL write nothing.

#### Scenario: An agent cannot simulate
- **WHEN** an employee with the `agent` role invokes the action
- **THEN** it is refused and no attempt is created

#### Scenario: Never simulate contact with an opted-out lead
- **WHEN** an admin invokes the action for a lead whose status is `opt_out`
- **THEN** it is refused, explaining that opt-out is terminal, and no attempt is created

#### Scenario: One call at a time
- **WHEN** an admin invokes the action while an attempt for that lead is in flight
- **THEN** it is refused and no second attempt is created
