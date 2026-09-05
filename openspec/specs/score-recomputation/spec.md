# score-recomputation Specification

## Purpose
Keeping a score honest after the criteria move. Detects that a scored attempt is stale, classifies deterministically from the audit log whether refreshing it needs a free re-score or a transcript reprocess that costs a model call, and runs it only when a human asks. Nothing recomputes on its own.
## Requirements
### Requirement: A scored attempt is stale when criteria or settings changed after it
The system SHALL treat a scored attempt as stale when the newest
`criteria_audit_log.changed_at` is later than `call_attempts.scored_at`. An
attempt with a null `scored_at` SHALL be reported as never scored, not as stale.

#### Scenario: Weight changed after scoring
- **WHEN** an admin changes a criterion weight after a lead was scored
- **THEN** that lead is reported as stale

#### Scenario: Nothing changed since scoring
- **WHEN** no audit row is newer than `scored_at`
- **THEN** the lead is not stale and no banner is shown

#### Scenario: Never scored
- **WHEN** an attempt has `scored_at` null
- **THEN** it is reported as never scored and offers no recomputation action

### Requirement: The audit log classifies which recomputation is needed
The system SHALL classify staleness deterministically from the `field` column of
the audit rows newer than `scored_at`, with no model call and no heuristic.
Changes to `weight`, `blocking`, `sortOrder`, `deleted`, `active` from true to
false, `expected_value` on any criterion type, and either setting key SHALL
require only a pure re-score. Changes to `created`, `active` from false to true,
`type`, and `options` on an enum criterion SHALL require reprocessing the
transcript. Changes to `key`, `label`, `question_pt` and `question_en` SHALL NOT
mark anything stale.

#### Scenario: Threshold change needs only a re-score
- **WHEN** the only newer audit row is `setting:handoff_threshold`
- **THEN** the classification is pure re-score and no model call is offered

#### Scenario: A new criterion needs reprocessing
- **WHEN** a criterion was created after the lead was scored
- **THEN** the classification is reprocess, because the stored answers hold no row for it

#### Scenario: An enum's vocabulary changed
- **WHEN** `options` changed on an enum criterion
- **THEN** the classification is reprocess, because a stored normalised value may no longer be in the vocabulary

#### Scenario: Which enum values pass changed
- **WHEN** `expected_value` changed on an enum criterion while its `options` stayed the same
- **THEN** the classification is pure re-score, because the stored value is still a valid member of the unchanged vocabulary and only needs re-evaluating

#### Scenario: A numeric comparator changed
- **WHEN** `expected_value` changed from `>= 300` to `>= 250` on a numeric criterion
- **THEN** the classification is pure re-score, because the stored number is still valid

#### Scenario: Question wording changed
- **WHEN** only `question_pt` changed
- **THEN** nothing is marked stale

#### Scenario: Mixed changes take the more expensive path
- **WHEN** both a weight and a criterion type changed after scoring
- **THEN** the classification is reprocess

#### Scenario: A narrowed enum re-scores a previously passing lead
- **WHEN** `expected_value` drops `within_6_months` and a lead whose stored answer is `within_6_months` is re-scored
- **THEN** that criterion now fails, the score drops accordingly and no model was called

### Requirement: Recomputation only ever happens on an explicit action
The system MUST NOT recompute a score automatically. Saving a criterion or a
setting SHALL mark affected leads stale and SHALL NOT rewrite any score.

#### Scenario: Saving a criterion changes no score
- **WHEN** an admin saves a new weight
- **THEN** no lead score changes until someone triggers a recomputation

#### Scenario: Employee triggers a re-score
- **WHEN** an employee triggers the pure re-score action
- **THEN** `scoreLead` runs over the stored answers, the score, decision and `scored_at` are updated and no model is called

#### Scenario: Employee triggers a reprocess
- **WHEN** an employee triggers the reprocess action
- **THEN** extraction runs again over the stored transcript, answers are upserted and the score, narrative and `scored_at` are updated

### Requirement: A pure re-score reuses stored answers and stays deterministic
A pure re-score SHALL read the persisted answers and MUST NOT call any model.
Given the same answers, criteria and settings it SHALL produce the same score
every time.

#### Scenario: Threshold lowered
- **WHEN** the threshold changes from 70 to 60 and a lead scoring 65 is re-scored
- **THEN** the decision becomes `qualified` without any new extraction

#### Scenario: Repeated re-score is idempotent
- **WHEN** the same pure re-score runs twice with nothing changed in between
- **THEN** the score and decision are identical both times

### Requirement: An expired transcript freezes the score
When the transcript was purged under the twelve-month retention of spec section
10, reprocessing SHALL be unavailable. The system SHALL keep the last computed
score and report that criteria changed since it was produced.

#### Scenario: Reprocess on a purged transcript
- **WHEN** a stale lead needs reprocessing but its transcript is gone
- **THEN** the reprocess action is unavailable and the portal explains why

#### Scenario: Re-score still works without a transcript
- **WHEN** a stale lead needs only a pure re-score and its transcript is gone
- **THEN** the re-score runs normally, because it reads answers rather than the transcript

