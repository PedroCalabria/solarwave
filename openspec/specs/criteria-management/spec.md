# criteria-management Specification

## Purpose
How employees define what qualifies a lead: the fields a criterion carries, the vocabulary an enum criterion can be answered with versus the subset that passes, the hand-off threshold and answered-share settings, and the audit trail that records every change (spec sections 5.3 and 5.4).
## Requirements
### Requirement: Criteria carry the fields the agent and the engine need
A qualification criterion SHALL have a unique `key`, `label`, `question_pt`, `question_en`, `type` (`boolean|numeric|enum|free_text`), `expected_value`, integer `weight` between 0 and 100, `blocking`, `active`, `sort_order` and `updated_by`.

#### Scenario: Create a valid criterion
- **WHEN** an admin submits a criterion with all required fields and `weight = 25`
- **THEN** it is persisted and appears in the criteria list

#### Scenario: Reject invalid weight
- **WHEN** an admin submits `weight = 120`
- **THEN** the save is rejected with a field error

#### Scenario: Reject expected value that does not parse for the type
- **WHEN** an admin submits a numeric criterion with `expected_value = "high"`
- **THEN** the save is rejected with a field error explaining the accepted grammar

#### Scenario: Duplicate key
- **WHEN** an admin submits a criterion whose `key` already exists
- **THEN** the save is rejected

### Requirement: Every criterion change is audited
Each create, field update, activation toggle or deletion of a criterion SHALL write one `criteria_audit_log` row per changed field with the acting employee, timestamp, field name, previous value and new value.

#### Scenario: Weight change
- **WHEN** an admin changes a criterion's weight from 20 to 25
- **THEN** an audit row exists with `field = weight`, `old_value = 20`, `new_value = 25`, the admin's id and a timestamp

#### Scenario: Multi-field edit
- **WHEN** an admin changes both `question_pt` and `blocking` in one save
- **THEN** two audit rows are written in the same transaction

#### Scenario: Creation
- **WHEN** a criterion is created
- **THEN** an audit row with `field = created` records the new key, type and weight

#### Scenario: Deletion
- **WHEN** a criterion is deleted
- **THEN** an audit row with `field = deleted` records its key, and existing qualification answers referencing it are preserved

### Requirement: Hand-off threshold is a persisted, audited setting
The system SHALL store `handoff_threshold` (integer 0–100, default 70) and `min_answered_weight_share` (0–1, default 0.6) in `settings`, and changes SHALL be audited like criteria changes with `field = setting:<key>`.

#### Scenario: Change threshold
- **WHEN** an admin sets the threshold to 65
- **THEN** the setting is persisted and an audit row records `old_value = 70`, `new_value = 65`

#### Scenario: Reject out-of-range threshold
- **WHEN** an admin sets the threshold to 101
- **THEN** the save is rejected

### Requirement: Question budget warning
The criteria page SHALL display the count of active criteria and SHALL show a warning when more than six are active, because the call targets two minutes.

#### Scenario: Seven active criteria
- **WHEN** an admin activates a seventh criterion
- **THEN** the page shows a warning that the call may exceed two minutes

#### Scenario: Six or fewer
- **WHEN** six criteria are active
- **THEN** no warning is shown

### Requirement: Only admins mutate criteria and settings
Server Actions that create, update, toggle or delete criteria or change settings MUST verify the caller's role is `admin` and MUST reject `agent` callers.

#### Scenario: Agent attempts a change
- **WHEN** an authenticated `agent` submits a criterion update
- **THEN** the action is rejected with a forbidden error and no audit row is written

#### Scenario: Agent can read
- **WHEN** an authenticated `agent` opens the criteria page
- **THEN** the list is shown read-only

