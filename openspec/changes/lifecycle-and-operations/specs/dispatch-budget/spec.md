## ADDED Requirements

### Requirement: Automatic dispatch is disabled by default
The system SHALL carry a persisted setting controlling whether the durable run
may place calls, and that setting SHALL default to disabled. Deploying the
scheduler MUST NOT cause a call to be placed until the setting is deliberately
enabled.

#### Scenario: A fresh installation places no automatic call
- **WHEN** the system is deployed and leads are created, with the setting never
  having been changed
- **THEN** no call is dispatched by any run

#### Scenario: Enabling is a recorded act
- **WHEN** an administrator enables automatic dispatch
- **THEN** the change is audited with the employee, the previous value and the
  new value, like every other setting

### Requirement: The enable flag gates the scheduler, not an administrator
The automatic dispatch setting SHALL be enforced only against dispatches
originating from the durable run. A call placed deliberately by an administrator
from the portal, or through the internal dispatch route, SHALL NOT be refused for
this reason.

#### Scenario: The run is refused while dispatch is disabled
- **WHEN** a run attempts to dispatch and automatic dispatch is disabled
- **THEN** the dispatch is refused with a reason naming the disabled setting

#### Scenario: An administrator is not refused
- **WHEN** an administrator places a call from the lead detail while automatic
  dispatch is disabled
- **THEN** the call is not refused for that reason

### Requirement: A daily call budget refuses every dispatch, including a manual one
The system SHALL carry a persisted daily budget for the number of calls placed,
and SHALL refuse any dispatch that would exceed it, whether it originates from the
run or from a person. Manual dispatch is not exempt, because unattended
consumption is not the only way a free-tier allowance is exhausted.

#### Scenario: The budget refuses the scheduler
- **WHEN** the daily call budget is reached and a run attempts to dispatch
- **THEN** the dispatch is refused with a budget reason

#### Scenario: The budget refuses an administrator
- **WHEN** the daily call budget is reached and an administrator presses the call
  action
- **THEN** the dispatch is refused with a budget reason and the portal explains it

#### Scenario: The budget resets over its window
- **WHEN** the calls counted against the budget fall outside its window
- **THEN** a dispatch is allowed again without any setting being changed

### Requirement: A voice-second budget refuses every dispatch
The system SHALL carry a persisted budget for telephony seconds consumed over a
longer window, matching the telephony provider's own allowance, and SHALL refuse
any dispatch once the recorded consumption reaches it. This budget SHALL apply to
the run and to a person alike.

#### Scenario: Consumed seconds refuse a further call
- **WHEN** the recorded telephony seconds within the window reach the budget
- **THEN** any dispatch is refused with a budget reason naming the exhausted
  budget

#### Scenario: The two budgets are distinguishable
- **WHEN** a dispatch is refused for a budget
- **THEN** the reason identifies which budget was exhausted

### Requirement: A budget is evaluated inside the transaction that reserves the attempt
The budget decision MUST be taken inside the same transaction that reserves the
attempt number and writes the attempt row, so that simultaneous dispatches cannot
both pass a budget that only one of them fits in. A telephone call cannot be
recalled once placed.

#### Scenario: Two dispatches race the last unit of budget
- **WHEN** two dispatches are evaluated simultaneously with one call of budget
  remaining
- **THEN** exactly one attempt is created and the other is refused with a budget
  reason

### Requirement: Each attempt records what it consumed
When an attempt closes, the system SHALL record the telephony seconds it consumed
and the realtime seconds its conversation held, as separate values on the attempt.
An attempt that consumed neither SHALL record zero or nothing rather than an
invented figure.

#### Scenario: A connected call records both figures
- **WHEN** a call connects, converses and ends
- **THEN** the attempt carries the telephony seconds reported for the call and the
  realtime seconds the conversation held

#### Scenario: An unanswered call records no conversation
- **WHEN** a call is never answered
- **THEN** the attempt records no realtime seconds, and the telephony figure is
  whatever the provider reported

#### Scenario: The recorded figure is what was observed
- **WHEN** the realtime seconds are recorded
- **THEN** the value is the duration the system observed and is not presented as
  provider metering
