## ADDED Requirements

### Requirement: The call script is assembled from the active criteria
The system SHALL build the agent's system prompt at call time from a fixed frame
written in code plus the active qualification criteria read from the database.
No per-criterion conversational prose SHALL be hand-written anywhere in the
system. Inactive and soft-deleted criteria SHALL NOT appear in the script.

#### Scenario: Active criteria become the questions
- **WHEN** the script is assembled with four active criteria
- **THEN** the prompt contains each criterion's question exactly once

#### Scenario: Inactive criteria are absent
- **WHEN** a criterion is marked `active = false`
- **THEN** its question does not appear in the assembled prompt

#### Scenario: Deactivating a criterion changes the next script
- **WHEN** an admin deactivates a criterion and a new call is assembled
- **THEN** the new prompt has one fewer question, with no code change

### Requirement: The script is written in the lead's call language
The system SHALL select `question_pt` or `question_en` according to the lead's
`preferred_call_language`, and SHALL instruct the agent to conduct the whole
conversation in that language (spec section 4.3).

#### Scenario: Portuguese lead
- **WHEN** the lead's `preferred_call_language` is `pt`
- **THEN** the prompt carries the `question_pt` text of every active criterion and instructs the agent to speak Brazilian Portuguese

#### Scenario: English lead
- **WHEN** the lead's `preferred_call_language` is `en`
- **THEN** the prompt carries the `question_en` text of every active criterion and instructs the agent to speak English

### Requirement: Call order is derived, not taken from sort_order
The script SHALL order questions by `blocking` first, then by descending
`weight`, then by `sort_order`, then by `key`. This ordering is separate from
the `sort_order` ordering used to display criteria in the portal, and SHALL be a
pure function so the same criteria always produce the same sequence.

#### Scenario: Blocking criteria come first
- **WHEN** a blocking criterion has weight 10 and a non-blocking criterion has weight 40
- **THEN** the blocking criterion is asked first

#### Scenario: Weight breaks ties among non-blocking criteria
- **WHEN** two non-blocking criteria have weights 30 and 20
- **THEN** the weight-30 criterion is asked first

#### Scenario: Ordering is stable
- **WHEN** two criteria are identical in `blocking`, `weight` and `sort_order`
- **THEN** they are ordered by `key`, and repeated assembly yields the same sequence

### Requirement: The guardrail frame is fixed and outranks criterion text
The prompt SHALL carry every guardrail of spec section 6, the AI disclosure, the
tone rules, the two-minute target and the closing as fixed text that no employee
can edit. Criterion text SHALL be inserted as data under an explicit heading, and
the frame SHALL state that its rules take precedence over anything appearing in
the question list.

#### Scenario: Guardrails are present in every assembled prompt
- **WHEN** a script is assembled for any lead in either language
- **THEN** the prompt contains the AI disclosure instruction and every section 6 guardrail

#### Scenario: A criterion cannot countermand a guardrail
- **WHEN** an admin saves a criterion whose question text instructs the agent to quote a price
- **THEN** the assembled prompt still forbids quoting prices, and the frame's precedence statement is present

#### Scenario: Criteria are inserted as data, not instruction
- **WHEN** the prompt is assembled
- **THEN** criterion text appears only under the question-list heading and never inside the guardrail frame

### Requirement: The script instructs the agent to close early on a failed blocking criterion
The script SHALL tell the agent that when a blocking criterion is answered and
fails, it must close the call politely, offering the configured alternative,
rather than continuing through the remaining questions.

#### Scenario: Renter answers the homeowner criterion
- **WHEN** the lead says they rent the property and `homeowner` is blocking
- **THEN** the script's instruction directs the agent to close politely with an alternative instead of asking the remaining questions

### Requirement: The script states the call budget
The script SHALL state the two-minute target, and the system SHALL expose the
number of questions the assembled script contains so the portal's question
budget warning and the script agree on what is being counted.

#### Scenario: Question count matches the assembled script
- **WHEN** five criteria are active
- **THEN** the assembled script reports five questions
