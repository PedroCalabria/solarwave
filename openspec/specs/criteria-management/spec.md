# criteria-management Specification

## Purpose
How employees define what qualifies a lead: the fields a criterion carries, the vocabulary an enum criterion can be answered with versus the subset that passes, the hand-off threshold and answered-share settings, and the audit trail that records every change (spec sections 5.3 and 5.4).
## Requirements
### Requirement: Criteria carry the fields the agent and the engine need
A qualification criterion SHALL have a unique `key`, `label`, `question_pt`, `question_en`, `type` (`boolean|numeric|enum|free_text`), `options`, `expected_value`, integer `weight` between 0 and 100, `blocking`, `active`, `sort_order` and `updated_by`.

`options` is the vocabulary an `enum` criterion can be answered with, written in the same pipe-separated grammar as `expected_value`. It is distinct from `expected_value`, which is the subset of that vocabulary that passes. An `enum` criterion SHALL have at least two options, and its `expected_value` SHALL be a non-empty subset of them. A criterion of any other type SHALL NOT have options.

#### Scenario: Create a valid criterion
- **WHEN** an admin submits a criterion with all required fields and `weight = 25`
- **THEN** it is persisted and appears in the criteria list

#### Scenario: Create a valid enum criterion
- **WHEN** an admin submits an enum criterion with `options = "this_month|within_3_months|within_6_months"` and `expected_value = "this_month|within_3_months"`
- **THEN** it is persisted, and answers may later take any of the three values while only the first two pass

#### Scenario: Reject invalid weight
- **WHEN** an admin submits `weight = 120`
- **THEN** the save is rejected with a field error

#### Scenario: Reject expected value that does not parse for the type
- **WHEN** an admin submits a numeric criterion with `expected_value = "high"`
- **THEN** the save is rejected with a field error explaining the accepted grammar

#### Scenario: Reject an enum criterion without a vocabulary
- **WHEN** an admin submits an enum criterion with no `options`
- **THEN** the save is rejected with a field error on `options`

#### Scenario: Reject an expected value outside the vocabulary
- **WHEN** an admin submits `options = "ceramic|metal"` and `expected_value = "ceramic|slab"`
- **THEN** the save is rejected with a field error naming `slab` as not being one of the options

#### Scenario: Reject options on a non-enum criterion
- **WHEN** an admin submits a numeric criterion with `options = "a|b"`
- **THEN** the save is rejected with a field error on `options`

#### Scenario: Duplicate key
- **WHEN** an admin submits a criterion whose `key` already exists
- **THEN** the save is rejected

### Requirement: Every criterion change is audited
Each create, field update, activation toggle or deletion of a criterion SHALL write one `criteria_audit_log` row per changed field with the acting employee, timestamp, field name, previous value and new value. `options` SHALL be audited like every other field, because the recomputation classifier distinguishes an `options` change from an `expected_value` change and reads that distinction from the audit log.

#### Scenario: Weight change
- **WHEN** an admin changes a criterion's weight from 20 to 25
- **THEN** an audit row exists with `field = weight`, `old_value = 20`, `new_value = 25`, the admin's id and a timestamp

#### Scenario: Multi-field edit
- **WHEN** an admin changes both `question_pt` and `blocking` in one save
- **THEN** two audit rows are written in the same transaction

#### Scenario: Vocabulary change is distinguishable from a pass-rule change
- **WHEN** an admin widens `options` and narrows `expected_value` in one save
- **THEN** two audit rows are written, one per field, so the classifier can tell that reprocessing is required

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

### Requirement: Saving a criterion may return advisory warnings
The criteria form SHALL be able to carry warnings alongside a successful save.
Warnings are advice about a saved criterion, distinct from the field errors that
reject a save. A warning SHALL never change whether a criterion was persisted.

#### Scenario: Saved with a warning
- **WHEN** a criterion is saved and the linter reports a tone concern
- **THEN** the form reports the save succeeded and shows the warning separately from any field error

#### Scenario: Warnings and field errors are distinct
- **WHEN** a save is rejected for an invalid weight
- **THEN** the response carries a field error and no warnings

### Requirement: The criteria view shows the derived call order
Because the script orders questions by `blocking` and `weight` rather than by
`sort_order`, the criteria view SHALL show the order in which the agent will
actually ask the active criteria, so an admin editing `sort_order` is not misled
about the call.

#### Scenario: Call order differs from list order
- **WHEN** a blocking criterion sits last in `sort_order`
- **THEN** the criteria view shows it first in the call order preview while the list keeps its `sort_order` position

#### Scenario: Only active criteria appear in the preview
- **WHEN** a criterion is inactive
- **THEN** it is absent from the call order preview

