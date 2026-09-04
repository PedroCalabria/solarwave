## ADDED Requirements

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
The lead detail page SHALL show the lead's fields, every call attempt with number, outcome, times and duration, the qualification answers for the latest scored attempt as a list driven by criteria (label, extracted value, passed flag), and the transcript turns of the latest attempt when present.

#### Scenario: Lead with a scored attempt
- **WHEN** an employee opens a lead whose latest attempt has answers
- **THEN** each active criterion is listed with its extracted value and pass/fail mark, and the score, reason and icebreaker are shown

#### Scenario: Lead without attempts
- **WHEN** an employee opens a `new` lead
- **THEN** the page shows "no call attempts yet" and the scheduled `next_call_at`

#### Scenario: Attempt without transcript
- **WHEN** the latest attempt has outcome `no_answer`
- **THEN** the transcript area explains that no conversation happened

#### Scenario: Unknown lead id
- **WHEN** the id does not exist
- **THEN** the page returns not found

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
