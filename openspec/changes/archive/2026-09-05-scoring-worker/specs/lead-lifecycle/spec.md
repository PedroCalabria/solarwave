## ADDED Requirements

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
