## MODIFIED Requirements

### Requirement: Lead detail shows attempts, answers and transcript from the database
The lead detail page SHALL show the lead's fields, every call attempt with number, outcome, times and duration, the qualification answers for the latest scored attempt as a list driven by criteria (label, extracted value, passed flag, extraction confidence and the evidence quote), and the transcript turns of the latest attempt when present. Answers SHALL keep their criteria-driven order, and low-confidence answers SHALL be marked so they are easy to find without losing that order. Each answer SHALL show the verbatim evidence quote it was extracted from, when one survived verification.

#### Scenario: Lead with a scored attempt
- **WHEN** an employee opens a lead whose latest attempt has answers
- **THEN** each active criterion is listed with its extracted value, pass/fail mark, confidence and evidence quote, and the score, reason and icebreaker are shown

#### Scenario: Lead without attempts
- **WHEN** an employee opens a `new` lead
- **THEN** the page shows "no call attempts yet" and the scheduled `next_call_at`

#### Scenario: Attempt without transcript
- **WHEN** the latest attempt has outcome `no_answer`
- **THEN** the transcript area explains that no conversation happened

#### Scenario: Unknown lead id
- **WHEN** the id does not exist
- **THEN** the page returns not found

#### Scenario: Low-confidence answer is visible
- **WHEN** an answer was extracted with confidence 0.30
- **THEN** it is marked for review and the panel header counts it, while it still counts towards the score exactly as any other answer

## ADDED Requirements

### Requirement: The lead detail states when a score is stale and what it would cost to refresh
When a scored attempt is stale the page SHALL show a banner naming the action
that applies: a pure re-score described as instant and free, or a transcript
reprocess described as using AI. The banner MUST NOT offer reprocessing when the
transcript has been purged.

#### Scenario: Only a threshold changed
- **WHEN** the staleness classification is pure re-score
- **THEN** the banner offers the instant re-score and does not mention AI

#### Scenario: A criterion was created
- **WHEN** the staleness classification is reprocess
- **THEN** the banner says the transcript will be reprocessed with AI before the employee confirms

#### Scenario: Transcript already purged
- **WHEN** reprocessing is required but the transcript is gone
- **THEN** the banner explains the score is frozen and offers no reprocess action

#### Scenario: Fresh score
- **WHEN** nothing changed since `scored_at`
- **THEN** no banner is shown

### Requirement: The portal lists guardrail violations for review
The portal SHALL provide a view of `guardrail_violations` newest first, showing
the lead, the attempt, the guardrail, the severity, the evidence quote and the
review state, and SHALL let an employee mark a violation reviewed.

#### Scenario: Reviewing a violation
- **WHEN** an employee marks a violation reviewed
- **THEN** it is recorded with the reviewer and the time, and moves out of the unreviewed list

#### Scenario: Blocked lead is identifiable
- **WHEN** a lead is blocked by an unreviewed high-severity violation
- **THEN** the list marks it as blocking outreach

#### Scenario: No violations
- **WHEN** no violation exists
- **THEN** the view shows an empty state rather than an error

### Requirement: The portal surfaces scoring pendings
The dashboard SHALL report attempts whose `scoring_status` is `failed`, and
SHALL let an employee retrigger scoring for one of them.

#### Scenario: Failed scoring is visible
- **WHEN** an attempt ended with `scoring_status = 'failed'`
- **THEN** it appears in the scoring pendings with a retrigger action

#### Scenario: Retrigger succeeds
- **WHEN** an employee retriggers a failed scoring and it completes
- **THEN** the attempt leaves the pendings list and the lead shows its new score
