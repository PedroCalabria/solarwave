# lead-lifecycle Specification

## Purpose
TBD - created by archiving change persistent-foundations. Update Purpose after archive.
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

