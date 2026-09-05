## ADDED Requirements

### Requirement: A call is placed only when every precondition holds
The system SHALL expose one dispatch operation that places a real call for a
lead, and it SHALL refuse to place that call unless all of the following hold:
the lead has not opted out, the lead has no call attempt in flight, the lead has
no unreviewed high-severity guardrail violation, the current time is inside the
lead's 08:00-22:00 local call window, the lead has not reached the maximum
attempt count, at least one qualification criterion is active, and the telephony
and voice model configuration is present. Each refusal SHALL be reported with a
distinct reason.

#### Scenario: A lead who opted out is never called
- **WHEN** dispatch is requested for a lead whose status is `opt_out`
- **THEN** no call is placed and the refusal reason is `opted_out`

#### Scenario: A lead with a call in flight is not called again
- **WHEN** dispatch is requested for a lead with a call attempt whose `ended_at` is null
- **THEN** no call is placed and the refusal reason is `attempt_in_flight`

#### Scenario: An unreviewed high-severity violation blocks the call
- **WHEN** dispatch is requested for a lead with an unreviewed high-severity guardrail violation
- **THEN** no call is placed and the refusal reason is `blocked_by_violation`

#### Scenario: Outside the call window
- **WHEN** dispatch is requested at 03:00 in the lead's DDD timezone
- **THEN** no call is placed and the refusal reason is `outside_call_window`

#### Scenario: Attempt cap reached
- **WHEN** dispatch is requested for a lead that has already made the maximum number of attempts
- **THEN** no call is placed and the refusal reason is `attempt_cap_reached`

#### Scenario: Nothing to ask
- **WHEN** dispatch is requested and no qualification criterion is active
- **THEN** no call is placed and the refusal reason is `no_active_criteria`

#### Scenario: Telephony not configured
- **WHEN** dispatch is requested and the Twilio credentials or the voice model id are absent
- **THEN** no call is placed and the refusal reason is `not_configured`

### Requirement: The opt-out and in-flight refusals are enforced under a row lock
The opt-out, in-flight and attempt-cap refusals SHALL be evaluated inside the
same transaction that reads the lead row for update and inserts the attempt, not
in the caller. A check performed before the transaction SHALL NOT be the only
protection, because the consequence of losing that race is a placed telephone
call that cannot be recalled.

#### Scenario: Two dispatches race for the same lead
- **WHEN** two dispatch requests for the same lead run concurrently
- **THEN** exactly one attempt row is created and the other is refused with `attempt_in_flight`

#### Scenario: Opt-out written between the check and the insert
- **WHEN** a lead opts out after a dispatch request has read the lead and before it inserts the attempt
- **THEN** the transaction refuses with `opted_out` and no call is placed

### Requirement: Dispatch creates the attempt that will receive the result
Dispatch SHALL create a `call_attempts` row before the call result can arrive,
with the next attempt number for the lead, `scheduled_at` and `started_at` set,
`outcome` null and `scoring_status` `pending`, and SHALL record the Twilio call
SID on that row as soon as the telephony provider returns it. The lead SHALL be
transitioned to `calling` by the same operation.

#### Scenario: A dispatched call has a findable attempt
- **WHEN** a call is placed successfully
- **THEN** an attempt row exists for the lead carrying the returned call SID, and the lead status is `calling`

#### Scenario: The provider rejects the call
- **WHEN** the telephony provider returns an error instead of a call SID
- **THEN** the attempt is closed with outcome `failed`, the retry transition is applied, and the lead is not left in `calling`

### Requirement: Dispatch is available to an admin and to an authorised internal caller
The system SHALL offer dispatch as an admin-only action from the lead detail and
as an internal HTTP endpoint guarded by a shared secret. Both SHALL run the same
dispatch operation with the same preconditions. The internal endpoint SHALL
reject an unauthenticated request without reading its body.

#### Scenario: A non-admin employee cannot place a call
- **WHEN** an employee with the `agent` role invokes the dispatch action
- **THEN** the request is rejected and no call is placed

#### Scenario: The internal endpoint requires the secret
- **WHEN** the internal dispatch endpoint is called without the shared secret
- **THEN** it responds 401 and no call is placed

### Requirement: The call is placed with answering-machine detection enabled
The system SHALL place the outbound call with asynchronous answering-machine
detection enabled, SHALL supply the URL that returns the call instructions, and
SHALL supply a status callback URL that receives the completed call event. The
call SHALL also carry a provider-side duration limit no shorter than the
configured hard stop, so a bridge that stops enforcing the budget cannot leave
the line open indefinitely.

#### Scenario: Detection and callbacks are configured on every call
- **WHEN** a call is placed
- **THEN** the provider request enables machine detection and includes both the instruction URL and the status callback URL

#### Scenario: A provider-side duration limit is always set
- **WHEN** a call is placed with a hard stop of 180 seconds
- **THEN** the provider request carries a duration limit of at least 180 seconds
