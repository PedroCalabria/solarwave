# qualification-narrative Specification

## Purpose
The qualification reason and the icebreaker: one model call, written in the lead's call language because a human consultant reads the icebreaker aloud. Bound by the same content rules as the call itself, and never produced for a lead who opted out (spec sections 4.6 and 5.2).
## Requirements
### Requirement: Reason and icebreaker come from one model call
The worker SHALL produce the qualification reason and the icebreaker in a single
structured model call over the same evidence, and SHALL persist them to
`leads.qualification_reason` and `leads.icebreaker` in the same transaction as
the answers and the score.

#### Scenario: Both texts produced together
- **WHEN** an attempt is scored successfully
- **THEN** one model call returns both texts and both are stored on the lead

#### Scenario: Narrative failure aborts the run
- **WHEN** the narrative call fails after retries
- **THEN** the whole transaction rolls back, `scoring_status` is `failed`, and the lead keeps its previous reason and icebreaker

### Requirement: Narrative is written in the lead's call language
Both texts SHALL be written in the lead's `preferred_call_language`, because the
icebreaker is read aloud by a human consultant calling that lead.

#### Scenario: Brazilian lead
- **WHEN** the lead has `preferred_call_language = 'pt'`
- **THEN** the reason and the icebreaker are in Portuguese

#### Scenario: English-speaking lead
- **WHEN** the lead has `preferred_call_language = 'en'`
- **THEN** the reason and the icebreaker are in English

### Requirement: The reason explains the score from the actual answers
The reason SHALL cite which criteria passed, which failed and which went
unanswered, and MUST NOT contradict the computed decision. When a blocking
criterion failed the reason SHALL name it.

#### Scenario: Failed blocking criterion
- **WHEN** the lead is a renter and `homeowner` is blocking and failed
- **THEN** the reason states that the lead does not own the property and the decision is `disqualified`

#### Scenario: Incomplete call
- **WHEN** only two of five active criteria were answered
- **THEN** the reason says which criteria are still unknown

### Requirement: The narrative obeys the guardrails of spec section 6
The narrative model call SHALL be constrained by the same content rules as the
call itself. The generated texts MUST NOT contain prices, savings percentages,
installation timelines, technical claims, financial advice, competitor
comparisons or urgency language, even when the lead raised those topics.

#### Scenario: Lead asked about price
- **WHEN** the transcript contains the lead asking how much a system costs
- **THEN** the icebreaker mentions the topic as a question to address, without quoting or estimating any value

#### Scenario: Lead mentioned a deadline
- **WHEN** the lead said they want it installed this month
- **THEN** the icebreaker records the intent without promising any installation date

### Requirement: An opted-out lead gets no icebreaker
When the lead is `opt_out`, or an unreviewed high-severity opt-out violation
exists for the attempt, the worker SHALL NOT generate an icebreaker.

#### Scenario: Opted-out lead
- **WHEN** the lead's status is `opt_out`
- **THEN** the icebreaker stays null and the portal explains that no outreach text is produced

