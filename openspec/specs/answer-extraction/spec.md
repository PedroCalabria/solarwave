# answer-extraction Specification

## Purpose
Turns a call transcript into typed, evidence-backed answers under a schema generated from the active criteria, and governs the `scoring_status` lifecycle around that. Enum criteria are constrained to their `options` vocabulary rather than to what passes, so an answer that fails the rule stays expressible. The persisted answer is where determinism begins: the score is a function of the stored rows, never of the transcript (spec section 4.6).
## Requirements
### Requirement: The extraction schema is generated from the active criteria
The worker SHALL build the structured-output schema from the active criteria
rather than from the criterion type alone, reusing the core list parser so the
schema and the engine cannot drift. Each property SHALL carry `value`,
`confidence` and `evidence`, and an `enum` criterion SHALL constrain `value` to
exactly the literals of its `options` vocabulary.

The schema MUST NOT be constrained to `expected_value`. `expected_value` is the
subset that passes, so constraining to it would make a failing enum answer
unrepresentable and no enum criterion could ever fail.

#### Scenario: Enum criterion constrains the model to its vocabulary
- **WHEN** the criterion `purchase_timeline` has `options` of `this_month|within_3_months|within_6_months` and the lead says "esse mes mesmo"
- **THEN** the schema offers exactly those three values and the extracted answer is `this_month`

#### Scenario: A failing enum answer is still representable
- **WHEN** that criterion has `expected_value` of `this_month|within_3_months` and the lead says "in the next four to six months"
- **THEN** the extracted answer is `within_6_months` and the criterion fails, rather than the answer being null

#### Scenario: An answer outside the vocabulary
- **WHEN** a `roof_type` criterion has `options` of `ceramic|metal|slab` and the lead describes something none of them cover
- **THEN** the value is null, the criterion counts as unanswered, and the evidence still quotes what was said

#### Scenario: Numeric criterion accepts a number
- **WHEN** a numeric criterion is extracted and the lead said "veio setecentos e vinte"
- **THEN** the extracted `value` is the number `720`, not the spoken text

#### Scenario: Inactive criteria are absent from the schema
- **WHEN** a criterion is `active = false`
- **THEN** it has no property in the schema and no answer row is written for it

#### Scenario: Malformed expected value blocks extraction
- **WHEN** an active numeric criterion has `expected_value = "lots"`
- **THEN** the worker fails with a validation error naming the criterion and calls no model

#### Scenario: Enum criterion with no vocabulary blocks extraction
- **WHEN** an active enum criterion has no `options`
- **THEN** the worker fails with a validation error naming the criterion and calls no model

### Requirement: Every extracted answer carries confidence and verbatim evidence
Each answer SHALL record a `confidence` between 0 and 1 and an `evidence` string
quoted from the transcript. Evidence MUST be a literal excerpt of a transcript
turn, never a paraphrase.

#### Scenario: Evidence is quoted
- **WHEN** the roof type is extracted from the turn "Cerâmica, e pega bastante sol de manhã."
- **THEN** the stored `evidence` is an exact substring of that turn

#### Scenario: Criterion never discussed
- **WHEN** the transcript contains nothing about a criterion
- **THEN** its `value` is null, no answer row counts as answered, and no evidence is invented

### Requirement: Confidence never changes the score
The engine MUST NOT receive `confidence`. A low-confidence answer SHALL be
scored exactly like a high-confidence one and MUST NOT alter
`answeredWeightShare`, `enoughInformation`, the attempt outcome or the retry
schedule.

#### Scenario: Low confidence still counts as answered
- **WHEN** an answer is extracted with confidence 0.30
- **THEN** it counts as answered, contributes its weight normally and does not cause a retry

### Requirement: Answers are persisted as one transactional upsert
The worker SHALL write all answers for an attempt, the score, the narrative and
`scored_at` in a single transaction, upserting on
`unique(call_attempt_id, criteria_id)`. It MUST NOT append answers
incrementally, so a retried run cannot mix results from two executions.

#### Scenario: Retried run replaces rather than duplicates
- **WHEN** extraction is run twice for the same attempt
- **THEN** each criterion has exactly one answer row and it holds the values of the last successful run

#### Scenario: Partial failure writes nothing
- **WHEN** the narrative call fails after the answers were extracted
- **THEN** the transaction rolls back and the attempt keeps no partial answers

#### Scenario: Score is reproducible from stored answers
- **WHEN** two leads have identical answers, identical active criteria and the same threshold
- **THEN** their scores are identical

### Requirement: Scoring status follows pending, running, done or failed
`call_attempts.scoring_status` SHALL move to `running` when the worker starts,
`done` on success with `scored_at` stamped, and `failed` after the retries are
exhausted. Transient model failures SHALL be retried with exponential backoff
inside the worker.

#### Scenario: Successful run
- **WHEN** scoring completes
- **THEN** `scoring_status` is `done` and `scored_at` holds the time of the transaction

#### Scenario: Transient failure is retried
- **WHEN** the model call fails with a rate-limit error on the first try and succeeds on the second
- **THEN** `scoring_status` ends as `done` and only one set of answers exists

#### Scenario: Exhausted retries
- **WHEN** every retry fails
- **THEN** `scoring_status` is `failed`, `scored_at` stays null and the attempt is listed as a scoring pending in the portal

### Requirement: A failed scoring never transitions the lead
When scoring fails the worker MUST NOT call `applyLeadTransition` and MUST NOT
invent a qualification decision. The lead SHALL keep the status it had.

#### Scenario: Lead is untouched after a failure
- **WHEN** scoring fails for a `calling` lead
- **THEN** the lead is still `calling`, its score is unchanged and no transition row is written

#### Scenario: Live answers are not a fallback
- **WHEN** scoring fails and the live agent had recorded advisory answers during the call
- **THEN** the worker does not score from them

### Requirement: The worker exposes a callable entry point
The system SHALL expose `scoreAttempt(attemptId)` and a
`POST /api/internal/score` route protected by a shared secret. The route SHALL
reject unauthenticated calls.

#### Scenario: Authorised trigger
- **WHEN** the route is called with the correct secret and a valid attempt id
- **THEN** scoring runs and the response reports the resulting `scoring_status`

#### Scenario: Missing secret
- **WHEN** the route is called without the shared secret
- **THEN** it responds 401 and no model call is made

#### Scenario: Attempt without a transcript
- **WHEN** the attempt has no transcript
- **THEN** the worker returns a validation error, calls no model and leaves `scoring_status` as `pending`

