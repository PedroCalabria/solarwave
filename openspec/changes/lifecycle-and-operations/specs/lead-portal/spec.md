## ADDED Requirements

### Requirement: The portal offers an operations view for the scheduler and its budgets
The portal SHALL provide an administrator view showing whether automatic dispatch
is enabled, the configured budgets, and how much of each has been consumed in its
window. An agent SHALL be able to read it and SHALL NOT be able to change it.

#### Scenario: An administrator sees the state of the scheduler
- **WHEN** an administrator opens the operations view
- **THEN** it shows whether automatic dispatch is enabled, both budgets, and the
  consumption against each

#### Scenario: An agent reads but does not change
- **WHEN** an employee with the agent role opens the operations view
- **THEN** the values are visible and no control changes them

#### Scenario: Exhausted budget is visible before a call is attempted
- **WHEN** a budget is exhausted
- **THEN** the operations view shows it as exhausted, rather than the state being
  discoverable only by a refused call

### Requirement: The lead detail shows what each attempt consumed
The lead detail SHALL show, per attempt, the telephony duration and the realtime
duration recorded for it, and SHALL present the realtime figure as observed rather
than as provider metering.

#### Scenario: A completed attempt shows its consumption
- **WHEN** an attempt has recorded durations
- **THEN** the lead detail shows both alongside that attempt

#### Scenario: An attempt with nothing recorded shows nothing invented
- **WHEN** an attempt has no recorded durations
- **THEN** the lead detail shows none rather than a zero presented as a
  measurement

### Requirement: The lead detail shows a requested callback and what was done with it
When a lead asked to be called back, the lead detail SHALL show the request as it
was captured, and SHALL show whether it was used to schedule the next attempt or
whether the interval policy applied instead.

#### Scenario: A honoured request is shown as honoured
- **WHEN** a resolved callback time set the lead's next call time
- **THEN** the lead detail shows the verbatim request and the scheduled time

#### Scenario: A rejected request is shown as rejected
- **WHEN** a callback request could not be resolved, or fell outside the permitted
  bounds
- **THEN** the lead detail shows the verbatim request and states that the standard
  retry applied

### Requirement: A call in progress updates the dashboard without a manual refresh
While a lead is being called, the leads dashboard SHALL reflect the change of
status without the employee reloading the page, and SHALL stop consuming resources
for live updates when no lead is in a call.

#### Scenario: A lead entering a call appears without a reload
- **WHEN** a lead's status becomes `calling` while an employee has the dashboard
  open
- **THEN** the dashboard shows it within a few seconds and no reload is needed

#### Scenario: The call ending is reflected too
- **WHEN** the attempt closes and the lead's status changes
- **THEN** the dashboard reflects the new status without a reload

#### Scenario: A quiet dashboard does no work
- **WHEN** no lead is in a call
- **THEN** the dashboard is not polling or holding a live subscription
