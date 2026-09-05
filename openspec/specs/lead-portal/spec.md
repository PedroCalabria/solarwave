# lead-portal Specification

## Purpose
What employees see and can act on: the leads dashboard and its KPIs, the lead detail with attempts, answers, evidence and transcript, the guardrail violations queue, and the criteria and audit pages (spec section 5.2).
## Requirements
### Requirement: Leads dashboard reads from the database
The leads dashboard SHALL list persisted leads with name, phone, email, score, qualification reason, icebreaker and status, SHALL support filtering by status and free-text search over name, phone and email, and SHALL compute status counts from the database.

#### Scenario: Default listing
- **WHEN** an employee opens `/portal/leads`
- **THEN** all leads are listed newest first with their current status badges

#### Scenario: Status filter
- **WHEN** the employee selects `qualified`
- **THEN** only leads with `status = qualified` are shown and the counts reflect the database

#### Scenario: Search
- **WHEN** the employee types part of a phone number
- **THEN** only leads whose phone, name or email contains the query are shown

#### Scenario: Empty database
- **WHEN** no leads exist
- **THEN** the empty state is shown

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

### Requirement: Audit page lists criteria and settings changes
The audit page SHALL list `criteria_audit_log` rows newest first with employee name, timestamp, criterion label or setting key, field, previous and new value.

#### Scenario: After a weight change
- **WHEN** an admin changed a weight and opens `/portal/audit`
- **THEN** the first row shows that change with old and new values

### Requirement: Demo constants are removed from the portal
Portal pages and components MUST NOT import lead, criteria or audit data from `apps/web/src/lib/leads.ts`; only presentation helpers and types may remain there.

#### Scenario: Static check
- **WHEN** the codebase is searched for imports of `LEADS`, `CRITERIA`, `AUDIT` or `KPIS` from the demo module
- **THEN** none are found under `apps/web/src/app` or `apps/web/src/components`

### Requirement: Dashboard KPIs are computed
The KPI tiles (new today, qualified, awaiting retry, median score) SHALL be computed from the database at request time.

#### Scenario: New today
- **WHEN** three leads were created today in the portal's timezone
- **THEN** the "New today" tile shows 3

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

### Requirement: The lead detail offers an admin-only simulated call
The lead detail SHALL offer admins an action that runs a simulated text call for
that lead and refreshes the page with the resulting attempt, score, reason,
icebreaker, answers and transcript. The action SHALL NOT be offered to employees
with the `agent` role.

#### Scenario: Admin simulates a call
- **WHEN** an admin triggers the action on a lead with no attempts
- **THEN** the page reloads showing the new attempt with its transcript, score and narrative

#### Scenario: An agent does not see the action
- **WHEN** an employee with the `agent` role opens a lead detail
- **THEN** the simulate action is not offered

#### Scenario: A refusal is explained in place
- **WHEN** the action is refused because the lead opted out
- **THEN** the reason is shown on the lead detail and nothing about the lead changes

### Requirement: Simulated attempts are labelled wherever attempts are shown
The portal SHALL mark an attempt whose `ended_reason` is `simulated`, so that a
demonstration attempt is never read as a real call.

#### Scenario: Attempt list on the lead detail
- **WHEN** a lead has one simulated attempt and one real attempt
- **THEN** only the simulated one carries the label

