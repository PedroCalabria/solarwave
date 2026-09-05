# lead-lifecycle Specification

## Purpose
The state machine a lead moves through, from `new` to a terminal status. Transitions are computed by a pure function and applied under a row lock; opt-out is terminal and overrides everything (spec sections 4.5, 6 and 7).
## Requirements
### Requirement: Lead status follows the spec state machine
A lead SHALL be in exactly one of `new`, `calling`, `waiting_retry`, `no_answer_final`, `qualified`, `disqualified`, `opt_out`, and transitions SHALL be computed by a pure function that rejects any transition not in the allowed table.

#### Scenario: Dispatch from new
- **WHEN** a `new` lead receives `dispatch`
- **THEN** the status becomes `calling`

#### Scenario: Unanswered attempt with attempts remaining
- **WHEN** a `calling` lead records outcome `no_answer` and `attempt_count < 3`
- **THEN** the status becomes `waiting_retry`

#### Scenario: Unanswered final attempt
- **WHEN** a `calling` lead records outcome `no_answer` and `attempt_count = 3`
- **THEN** the status becomes `no_answer_final`

#### Scenario: Complete answered call above threshold
- **WHEN** a `calling` lead records `answered_complete` with score at or above the threshold and no failed blocking criterion
- **THEN** the status becomes `qualified`

#### Scenario: Complete answered call below threshold
- **WHEN** a `calling` lead records `answered_complete` with score below the threshold
- **THEN** the status becomes `disqualified`

#### Scenario: Illegal transition is rejected
- **WHEN** a `qualified` lead receives `dispatch`
- **THEN** the transition function returns an error and the status is unchanged

### Requirement: Incomplete answered calls retry like unanswered calls
Per spec section 4.5, an attempt that connected but ended before enough information was gathered SHALL record outcome `answered_incomplete` and SHALL follow the same retry path as `no_answer`.

#### Scenario: Incomplete call with attempts remaining
- **WHEN** a `calling` lead records `answered_incomplete` and `attempt_count < 3`
- **THEN** the status becomes `waiting_retry`

### Requirement: Minor detected retries, abusive lead disqualifies
An attempt where a minor answered SHALL record outcome `minor_answered` and follow the retry path; an attempt ended because the lead was hostile or abusive SHALL record outcome `abusive` and move the lead directly to `disqualified` with no retry.

#### Scenario: Minor answered
- **WHEN** a `calling` lead records `minor_answered` and `attempt_count < 3`
- **THEN** the status becomes `waiting_retry`

#### Scenario: Abusive lead
- **WHEN** a `calling` lead records `abusive`
- **THEN** the status becomes `disqualified` and `next_call_at` is `null`

### Requirement: Opt-out is terminal and overrides every other transition
Per spec section 6, an `opt_out` event MUST move a lead from any non-terminal status to `opt_out`, set `opt_out_at` and clear `next_call_at`; no event MUST ever move a lead out of `opt_out`.

#### Scenario: Opt-out during a call
- **WHEN** a `calling` lead receives `opt_out`
- **THEN** the status becomes `opt_out`, `opt_out_at` is set and `next_call_at` is `null`

#### Scenario: Opt-out while waiting for retry
- **WHEN** a `waiting_retry` lead receives `opt_out`
- **THEN** the status becomes `opt_out` and the pending retry is cancelled

#### Scenario: Nothing leaves opt-out
- **WHEN** an `opt_out` lead receives any event, including `dispatch`
- **THEN** the transition is rejected and the status stays `opt_out`

### Requirement: Enough information rule
The system SHALL consider an attempt to have gathered enough information when every active blocking criterion has an answer AND the sum of weights of answered active criteria divided by the sum of weights of all active criteria is at least the configured `min_answered_weight_share`.

#### Scenario: All blocking answered and share met
- **WHEN** the only blocking criterion is answered and answered weight share is 0.7 with a setting of 0.6
- **THEN** the rule returns `true`

#### Scenario: Blocking criterion unanswered
- **WHEN** a blocking criterion has no answer even though answered weight share is 0.9
- **THEN** the rule returns `false`

#### Scenario: Share below setting
- **WHEN** all blocking criteria are answered but answered weight share is 0.4 with a setting of 0.6
- **THEN** the rule returns `false`

### Requirement: Status transitions are applied under a row lock
When persisting a transition the system SHALL lock the lead row for update inside a transaction so that concurrent writers cannot apply conflicting transitions.

#### Scenario: Concurrent conflicting events
- **WHEN** an `opt_out` event and a `no_answer` outcome are applied to the same `calling` lead at the same time
- **THEN** the lead ends in `opt_out` and the losing write is rejected rather than overwriting it

### Requirement: No intermediate status exists between call end and scoring
The lifecycle SHALL NOT gain a `scoring` status. A lead SHALL remain `calling`
while its attempt is being scored, and the machine-facing detail SHALL be
carried by `call_attempts.scoring_status` instead. `LEAD_STATUSES` is unchanged
by this change.

#### Scenario: Lead while scoring runs
- **WHEN** a call has ended and `scoring_status` is `running`
- **THEN** the lead status is still `calling` and the portal badge is unchanged

#### Scenario: Lead after scoring succeeds
- **WHEN** scoring completes with a decision
- **THEN** the lead transitions on `attempt_ended` with that decision exactly as the existing transition table specifies

### Requirement: A failed scoring leaves the lead where it was
When `scoring_status` becomes `failed`, no lifecycle event SHALL be applied. The
system MUST NOT synthesise a `QualificationDecision` for an `answered_complete`
outcome that was never scored.

#### Scenario: Scoring exhausted its retries
- **WHEN** scoring fails permanently for a `calling` lead
- **THEN** the lead is still `calling`, `attempt_count` is unchanged and the attempt appears as a scoring pending

#### Scenario: Retriggered after a failure
- **WHEN** an employee retriggers scoring and it succeeds
- **THEN** the transition is applied then, with the real decision

### Requirement: An unreviewed high-severity guardrail violation blocks dispatch
A lead with an unreviewed `severity = 'high'` guardrail violation SHALL NOT be
dispatched for a new call attempt, regardless of its status and remaining
attempts.

#### Scenario: Missed opt-out blocks the next attempt
- **WHEN** a `waiting_retry` lead has an unreviewed `opt_out_missed` violation
- **THEN** no dispatch occurs and `next_call_at` stays null

#### Scenario: Reviewed violation stops blocking
- **WHEN** an employee reviews that violation and it was not a real opt-out
- **THEN** the lead becomes dispatchable again under the normal retry rules

