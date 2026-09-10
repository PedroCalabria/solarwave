## ADDED Requirements

### Requirement: One authenticated daily job performs every periodic task
The system SHALL expose a single scheduled maintenance endpoint that performs all
periodic work in one run, and it SHALL refuse any request that does not carry the
configured secret. The tasks share one cadence, none depends on another's result,
and one endpoint means one secret to hold rather than four; the hosting plan
limits how OFTEN a scheduled job may run, which is what fixes that cadence at
once a day.

#### Scenario: An unauthenticated request is refused
- **WHEN** the maintenance endpoint is called without the configured secret
- **THEN** the request is refused and no maintenance work is performed

#### Scenario: The scheduled run performs every task
- **WHEN** the maintenance endpoint runs with the correct secret
- **THEN** the purge, the reconciliation, the scoring recovery and the overdue
  sweep are all attempted, and the result reports what each one did

### Requirement: Transcripts past their retention are purged
The job SHALL delete the transcript of any attempt whose recorded expiry has
passed, per spec section 10's twelve-month retention, while leaving the attempt
row and its outcome intact. An attempt with no expiry recorded SHALL be left
alone.

#### Scenario: An expired transcript is removed
- **WHEN** an attempt's transcript expiry is in the past
- **THEN** its transcript is deleted and the attempt row, its outcome and its
  answers remain

#### Scenario: A transcript inside its retention is kept
- **WHEN** an attempt's transcript expiry is in the future
- **THEN** the transcript is unchanged

### Requirement: Attempts a lost callback abandoned are closed
The job SHALL close attempts that remain open past the maximum call duration plus
a margin, so that a lost provider callback cannot leave a lead permanently
appearing to be in a call. Until now this recovery ran only as part of dispatching
to the same lead, which is unreachable for a lead the condition has frozen.

#### Scenario: A frozen lead is recovered without anyone calling it
- **WHEN** an attempt has been open past the maximum call duration and its
  callback never arrived
- **THEN** the job closes the attempt and the lead becomes retryable rather than
  remaining in a call that is not happening

#### Scenario: A call still in progress is left alone
- **WHEN** an attempt started within the maximum call duration
- **THEN** the job does not close it

### Requirement: Attempts whose scoring never finished are recovered
The job SHALL find attempts that closed with a transcript and whose scoring did
not complete, and SHALL re-drive scoring for them. A scoring run that throws
currently leaves an attempt closed and permanently unscored, recoverable only by a
manual action in the portal.

#### Scenario: A failed scoring run is retried
- **WHEN** an attempt closed with a transcript and its scoring status is pending
  or failed
- **THEN** the job re-drives scoring for that attempt

#### Scenario: A scored attempt is not scored again
- **WHEN** an attempt's scoring completed
- **THEN** the job does not re-score it

### Requirement: Overdue leads are swept, with a margin that yields to the run
The job SHALL dispatch for leads whose scheduled next call time is overdue by more
than a margin, subject to every existing dispatch refusal and to the dispatch
budgets. The margin SHALL be large enough that a healthy durable run always places
the call first.

#### Scenario: A lead the scheduler missed is still called
- **WHEN** a lead's next call time passed more than the margin ago and no attempt
  was made
- **THEN** the job dispatches for it, subject to the usual refusals

#### Scenario: A lead the run is about to call is left to the run
- **WHEN** a lead's next call time passed less than the margin ago
- **THEN** the job does not dispatch for it

#### Scenario: The sweep never contacts an opted-out lead
- **WHEN** an opted-out lead somehow carries a scheduled next call time
- **THEN** the sweep dispatches nothing for it, per spec section 6

#### Scenario: The sweep obeys the budgets
- **WHEN** the daily call budget is exhausted and overdue leads exist
- **THEN** the sweep dispatches nothing further and reports the refusal

### Requirement: The job keeps the database from idling
The maintenance run's own database access SHALL serve as the periodic contact that
prevents the hosted database from suspending for inactivity. No separate job SHALL
exist for that purpose.

#### Scenario: A quiet week still contacts the database
- **WHEN** no lead is created and no call is placed for several days
- **THEN** the daily maintenance run has still issued a query against the
  database, and reports whether it was reachable

### Requirement: One failing task does not prevent the others
Each maintenance task SHALL be attempted independently, and a failure in one MUST
NOT prevent the remaining tasks from running. The response SHALL report each
task's outcome, including a failure.

#### Scenario: The purge fails and the rest continue
- **WHEN** the purge raises an error
- **THEN** the reconciliation, the scoring recovery and the sweep still run, and
  the response reports the purge as failed
