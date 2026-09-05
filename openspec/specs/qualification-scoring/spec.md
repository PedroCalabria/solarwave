# qualification-scoring Specification

## Purpose
The deterministic scoring engine: how an answer is evaluated against a criterion's `expected_value` per type, how the score is normalised over active weight, how a failed blocking criterion overrides it, and how the hand-off threshold decides qualification. A pure function of `{criteria, answers, settings}` that performs no I/O (spec section 4.6).
## Requirements
### Requirement: Expected value is evaluated per criterion type
The scoring engine SHALL evaluate an answer against a criterion's `expected_value` according to its type: boolean matches `true` or `false`; numeric satisfies a comparator expression (`>=`, `>`, `<=`, `<`, `=`) or an inclusive range `a..b`; enum matches any value in a pipe-separated list; free_text passes whenever an answer exists.

#### Scenario: Boolean match
- **WHEN** the criterion expects `true` and the normalised answer is `true`
- **THEN** the criterion passes

#### Scenario: Numeric comparator
- **WHEN** the criterion expects `>= 300` and the answer is `720`
- **THEN** the criterion passes

#### Scenario: Numeric range
- **WHEN** the criterion expects `300..1500` and the answer is `180`
- **THEN** the criterion fails

#### Scenario: Enum list
- **WHEN** the criterion expects `ceramic|metal` and the answer is `slab`
- **THEN** the criterion fails

#### Scenario: Free text
- **WHEN** a free_text criterion has any non-empty answer
- **THEN** the criterion passes

#### Scenario: Malformed expected value
- **WHEN** a numeric criterion has `expected_value = "lots"`
- **THEN** the engine returns a validation error identifying the criterion instead of a score

### Requirement: Score is deterministic and normalised to active weight
The engine SHALL compute `score = round(100 * passedWeight / activeWeight)` over active criteria only, treat unanswered criteria as not passed, and SHALL return the same output for the same input.

#### Scenario: All active criteria pass
- **WHEN** five active criteria totalling 100 weight all pass
- **THEN** the score is 100

#### Scenario: Partial pass with weights not summing to 100
- **WHEN** active criteria weigh 30, 25 and 20 and only the 30 and 20 pass
- **THEN** the score is 67

#### Scenario: Inactive criteria are ignored
- **WHEN** an inactive criterion with weight 50 would pass
- **THEN** it contributes to neither numerator nor denominator

#### Scenario: Unanswered criterion
- **WHEN** an active criterion has no answer
- **THEN** it contributes 0 to the numerator and its weight to the denominator

### Requirement: Blocking criteria override the score
A failed active blocking criterion SHALL produce decision `disqualified` regardless of score; the score SHALL still be computed and returned.

#### Scenario: Failed blocking with high score
- **WHEN** the homeowner criterion is blocking and fails while the other criteria give a score of 85
- **THEN** the decision is `disqualified`, `failedBlocking` contains `homeowner` and the score is 85

#### Scenario: Unanswered blocking criterion
- **WHEN** a blocking criterion has no answer
- **THEN** the decision is not `qualified` and the enough-information rule returns `false`

### Requirement: Hand-off threshold decides qualification
When no blocking criterion failed the engine SHALL return `qualified` if `score >= handoff_threshold` and `disqualified` otherwise, using the threshold from settings.

#### Scenario: At the threshold
- **WHEN** the score is 70 and the threshold is 70
- **THEN** the decision is `qualified`

#### Scenario: Below the threshold
- **WHEN** the score is 69 and the threshold is 70
- **THEN** the decision is `disqualified`

#### Scenario: Threshold change re-scores existing answers
- **WHEN** the threshold changes from 70 to 60 and the engine is re-run on stored answers scoring 65
- **THEN** the decision becomes `qualified` without any new extraction

### Requirement: Engine performs no I/O
The scoring engine MUST be a pure function of `{criteria, answers, settings}` and MUST NOT access the database, network or any LLM.

#### Scenario: Unit test without services
- **WHEN** the engine is executed in a test with no database or network available
- **THEN** it returns a result

