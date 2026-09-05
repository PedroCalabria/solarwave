## ADDED Requirements

### Requirement: A criterion's questions can be linted for tone and guardrail conflicts
The system SHALL provide an advisory check over a criterion's `question_pt` and
`question_en` that warns when a question insults or judges the lead, asks the
lead to justify a negative answer, or conflicts with a guardrail of spec
section 6. Each warning SHALL name the concern and the question it applies to.

#### Scenario: A judgemental question is flagged
- **WHEN** an admin lints a question that asks the lead to explain why they cannot afford the installation
- **THEN** a tone warning is returned naming that question

#### Scenario: A question that collides with the sensitive-data guardrail is flagged
- **WHEN** an admin lints a credit pre-check question that asks for a national id number
- **THEN** a guardrail warning is returned referencing the sensitive-data rule

#### Scenario: A question that collides with the financial-advice guardrail is flagged
- **WHEN** an admin lints a question asking which financing plan the lead intends to use
- **THEN** a guardrail warning is returned referencing the financial-advice rule

#### Scenario: A neutral question produces no warning
- **WHEN** an admin lints "O imóvel é seu ou alugado?"
- **THEN** no warnings are returned

### Requirement: Linting never blocks and never delays a save
Saving a criterion SHALL NOT wait on the linter and SHALL NOT be rejected because
of a warning. The lint SHALL run as a separate action, and the criteria form
SHALL also allow linting a question before saving it.

#### Scenario: Save completes without the linter
- **WHEN** an admin saves a valid criterion
- **THEN** the criterion is persisted and the response does not wait for any model call

#### Scenario: A warning does not prevent persistence
- **WHEN** an admin saves a criterion whose question the linter later warns about
- **THEN** the criterion remains saved and the warning is shown as advice

#### Scenario: Check before saving
- **WHEN** an admin lints a question they have typed but not yet submitted
- **THEN** warnings are returned without creating or modifying any criterion

### Requirement: The linter fails open
Any linter failure — no API key configured, a rate-limited request, malformed
model output or a timeout — SHALL resolve to zero warnings. It SHALL NOT surface
as a form error and SHALL NOT prevent any criteria operation.

#### Scenario: No API key configured
- **WHEN** the portal runs without a model API key and an admin saves a criterion
- **THEN** the criterion is saved and no warnings and no error are shown

#### Scenario: The provider rate-limits the request
- **WHEN** the lint request is rate-limited
- **THEN** the action returns no warnings and the criteria page stays usable

#### Scenario: The model returns unusable output
- **WHEN** the model's response cannot be parsed
- **THEN** the action returns no warnings rather than an error
