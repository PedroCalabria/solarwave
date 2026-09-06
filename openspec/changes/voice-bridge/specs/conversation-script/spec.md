## ADDED Requirements

### Requirement: The script is assembled for a stated medium
Script assembly SHALL accept the medium the call will be held in, `text` or
`voice`, and SHALL default to `text` so existing callers are unaffected. The
criteria assembly, the call order, the guardrail frame, the blocking-criterion
closing instruction and the budget statement SHALL be identical in both media;
only the medium-specific speech section differs.

#### Scenario: Text assembly is unchanged
- **WHEN** a script is assembled without stating a medium
- **THEN** the prompt is identical to the one assembled before this change

#### Scenario: The guardrails do not vary by medium
- **WHEN** scripts are assembled for the same lead in both media
- **THEN** both contain every spec section 6 guardrail, the same question list and the same call order

### Requirement: The voice medium adds speech rules to the fixed frame
When the medium is `voice`, the fixed frame SHALL additionally instruct the agent
to produce speech rather than written text: no markdown, no enumerated or
bulleted lists read aloud, short turns suited to a telephone, and numbers and
units spoken as words. These instructions SHALL live in the same fixed frame as
the guardrails, not in a separate prompt, so a guardrail added later cannot be
added to one medium and forgotten in the other.

#### Scenario: Voice output is speech-shaped
- **WHEN** a script is assembled for the voice medium
- **THEN** the prompt instructs the agent to avoid markdown and read-aloud lists and to keep turns short

#### Scenario: One frame, both media
- **WHEN** a new guardrail is added to the fixed frame
- **THEN** it appears in the assembled prompt for both media without a second edit

### Requirement: In the voice medium the agent speaks the AI disclosure first
When the medium is `voice`, the frame SHALL instruct the agent to speak first on
connection and to open with the AI disclosure, before asking any qualification
question and without waiting for the lead to speak (spec section 6).

#### Scenario: Disclosure ordered before questions
- **WHEN** a voice script is assembled
- **THEN** the prompt instructs the agent to open the call with the AI disclosure before its first question
