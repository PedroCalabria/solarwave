## MODIFIED Requirements

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
