## ADDED Requirements

### Requirement: Each lead's attempts are driven by a durable run
The system SHALL start a durable per-lead run when a lead is created, and that
run SHALL be responsible for placing every attempt the retry policy allows,
without a human action. The run SHALL wait until the lead's scheduled next call
time before dispatching, SHALL dispatch through the same call-placing function an
administrator uses, and SHALL repeat until the lead has no next attempt.

#### Scenario: A newly created lead is scheduled without anyone acting
- **WHEN** a lead is created by the intake API with a scheduled first call time
- **THEN** a durable run exists for that lead and its identifier is recorded on
  the lead

#### Scenario: The run waits for the scheduled time
- **WHEN** a run reaches a lead whose next call time is in the future
- **THEN** it waits until that time before dispatching, rather than dispatching
  immediately

#### Scenario: A retry is placed without a human
- **WHEN** an attempt ends unanswered and the retry policy schedules another
- **THEN** the run places the next attempt at the scheduled time

### Requirement: The run never dispatches for a terminal lead
The run SHALL re-read the lead before every dispatch and MUST NOT dispatch when
the lead is in a terminal status. An opted-out lead MUST never be dispatched to,
under any condition, and the run SHALL end rather than wait when it finds one.
Per spec section 6 this takes priority over every other rule the run applies.

#### Scenario: An opted-out lead ends the run
- **WHEN** the run wakes for a lead whose status is `opt_out`
- **THEN** no call is dispatched and the run ends

#### Scenario: Opt-out during the wait
- **WHEN** a lead opts out while the run is waiting for its next call time
- **THEN** the run dispatches nothing when it wakes, because it re-reads the lead
  before dispatching

#### Scenario: A qualified lead ends the run
- **WHEN** the run wakes for a lead whose status is `qualified`, `disqualified`
  or `no_answer_final`
- **THEN** no call is dispatched and the run ends

### Requirement: The run waits for an attempt to settle before deciding
After dispatching, the run SHALL wait at least as long as a call may last before
reading the lead again, so that the attempt has been closed and, when it produced
a transcript, scored. When an attempt closed with a transcript and its scoring did
not finish, the run SHALL re-drive scoring a bounded number of times before
reading the lead.

#### Scenario: The decision is taken after the attempt closed
- **WHEN** the run dispatches a call
- **THEN** it does not read the lead's next status until at least the maximum
  call duration has elapsed

#### Scenario: Scoring that never finished is re-driven
- **WHEN** an attempt closed with a transcript and its scoring status is still
  pending
- **THEN** the run re-drives scoring before reading the lead, up to a bounded
  number of attempts

#### Scenario: Re-driving gives up rather than looping
- **WHEN** scoring still has not finished after the bounded attempts
- **THEN** the run stops re-driving and continues, leaving the attempt for the
  daily maintenance job

### Requirement: The run stops when there is no next attempt
The run SHALL end when the lead is terminal, when the lead has no scheduled next
call time, or when a dispatch is refused for a reason that cannot change by
waiting. A refusal that can change by waiting SHALL NOT end the run.

#### Scenario: Attempts exhausted
- **WHEN** the third attempt ends unanswered and the lead becomes
  `no_answer_final`
- **THEN** the run ends

#### Scenario: A permanent refusal ends the run
- **WHEN** a dispatch is refused because the lead has opted out or has reached the
  attempt cap
- **THEN** the run ends

#### Scenario: A temporary refusal does not end the run
- **WHEN** a dispatch is refused because the lead is outside its call window or a
  budget is exhausted
- **THEN** the run does not end and waits for the next scheduled time

### Requirement: The run writes no lifecycle state
The run MUST NOT write a lead status, MUST NOT close an attempt and MUST NOT
produce a qualification decision. It SHALL obtain all of those by re-reading the
database after the call-closing and scoring paths have written them. The only
lead field the run itself writes is the identifier of the run.

#### Scenario: The run does not decide how an attempt ended
- **WHEN** a call ends
- **THEN** the attempt's outcome and the lead's new status are those written by
  the call-closing path, and the run has written neither

#### Scenario: Disabling the run changes no stored state
- **WHEN** automatic dispatch is disabled and every run stops
- **THEN** leads, attempts and their statuses remain exactly as the call-closing
  and scoring paths left them

### Requirement: Duplicate runs for one lead produce at most one attempt
More than one run MAY exist for a lead, and the system MUST NOT place more than
one call as a result. Mutual exclusion SHALL be provided by the transaction that
reserves the attempt, not by the recorded run identifier.

#### Scenario: Two runs wake at the same time
- **WHEN** two runs for the same lead dispatch simultaneously
- **THEN** exactly one attempt is created and the other dispatch is refused
  because an attempt is already in flight

#### Scenario: A lead with no run can be given one
- **WHEN** an administrator starts a run for a lead that has none
- **THEN** the run begins and the lead records its identifier
