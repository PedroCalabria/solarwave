## ADDED Requirements

### Requirement: The lead detail offers an admin-only real call
The lead detail SHALL offer an admin-only action that places a real qualification
call to the lead. The action SHALL be visibly distinct from the simulated-call
action, SHALL state that it dials a real telephone number and consumes telephony
minutes, and SHALL NOT be available to an employee with the `agent` role.

#### Scenario: An admin places a call
- **WHEN** an admin invokes the real-call action on a lead that satisfies every precondition
- **THEN** a call is placed, the lead moves to `calling`, and the lead detail reflects the new attempt

#### Scenario: An agent-role employee sees no real-call action
- **WHEN** an employee with the `agent` role opens a lead detail
- **THEN** the real-call action is not offered, and invoking it directly is rejected

#### Scenario: The two actions are not confusable
- **WHEN** an admin opens a lead detail
- **THEN** the real-call action and the simulated-call action are labelled distinctly, and the real one states that it dials a telephone

### Requirement: A refused call explains why in the portal
When a real call is refused, the portal SHALL show the specific reason in
employee-facing language, distinguishing an opted-out lead, an attempt already in
flight, an unreviewed high-severity guardrail violation, a lead outside its call
window, a lead at the attempt cap, no active criteria and missing configuration.

#### Scenario: Outside the call window
- **WHEN** an admin tries to call a lead whose local time is outside 08:00-22:00
- **THEN** the portal states that the lead is outside its call window and no call is placed

#### Scenario: Blocked by an unreviewed violation
- **WHEN** an admin tries to call a lead with an unreviewed high-severity guardrail violation
- **THEN** the portal states that a violation must be reviewed first and links to the violations view

#### Scenario: An opted-out lead
- **WHEN** an admin tries to call a lead who opted out
- **THEN** the portal states that contact is blocked for all future outreach and no call is placed

### Requirement: A real attempt is distinguishable from a simulated one
Wherever attempts are listed, a real telephone attempt SHALL be distinguishable
from a simulated one, and a real attempt SHALL show the identifier the telephony
provider assigned to the call so an operator can correlate it with the provider's
own records.

#### Scenario: Attempts are labelled by kind
- **WHEN** a lead has one simulated attempt and one real attempt
- **THEN** the lead detail labels each by kind and shows the provider call identifier on the real one

### Requirement: A call in progress is visible as in progress
While a lead has an attempt in flight, the lead detail SHALL show that a call is
in progress rather than presenting the lead as idle, and SHALL show the transcript
accumulated so far when one is available.

#### Scenario: A call in flight
- **WHEN** a lead has an attempt with no `ended_at`
- **THEN** the lead detail shows the call as in progress and offers no second call action
