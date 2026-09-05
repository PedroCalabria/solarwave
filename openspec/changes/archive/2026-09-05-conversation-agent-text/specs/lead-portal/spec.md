## ADDED Requirements

### Requirement: The lead detail offers an admin-only simulated call
The lead detail SHALL offer admins an action that runs a simulated text call for
that lead and refreshes the page with the resulting attempt, score, reason,
icebreaker, answers and transcript. The action SHALL NOT be offered to employees
with the `agent` role.

#### Scenario: Admin simulates a call
- **WHEN** an admin triggers the action on a lead with no attempts
- **THEN** the page reloads showing the new attempt with its transcript, score and narrative

#### Scenario: An agent does not see the action
- **WHEN** an employee with the `agent` role opens a lead detail
- **THEN** the simulate action is not offered

#### Scenario: A refusal is explained in place
- **WHEN** the action is refused because the lead opted out
- **THEN** the reason is shown on the lead detail and nothing about the lead changes

### Requirement: Simulated attempts are labelled wherever attempts are shown
The portal SHALL mark an attempt whose `ended_reason` is `simulated`, so that a
demonstration attempt is never read as a real call.

#### Scenario: Attempt list on the lead detail
- **WHEN** a lead has one simulated attempt and one real attempt
- **THEN** only the simulated one carries the label
