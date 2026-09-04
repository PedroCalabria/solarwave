# call-scheduling Specification

## Purpose
TBD - created by archiving change persistent-foundations. Update Purpose after archive.
## Requirements
### Requirement: DDD resolves to an IANA timezone
The system SHALL map a Brazilian DDD to an IANA timezone, defaulting to `America/Sao_Paulo`, with `America/Cuiaba` for 65 and 66, `America/Campo_Grande` for 67, `America/Manaus` for 92 and 97, `America/Boa_Vista` for 95, `America/Porto_Velho` for 69 and `America/Rio_Branco` for 68.

#### Scenario: Default zone
- **WHEN** the DDD is `21`
- **THEN** the timezone is `America/Sao_Paulo`

#### Scenario: UTC-4 zone
- **WHEN** the DDD is `92`
- **THEN** the timezone is `America/Manaus`

#### Scenario: UTC-5 zone
- **WHEN** the DDD is `68`
- **THEN** the timezone is `America/Rio_Branco`

#### Scenario: Unknown DDD
- **WHEN** the DDD is not a valid Brazilian area code
- **THEN** the function returns an error and no timezone is assumed

### Requirement: Calls are only allowed between 08:00 and 22:00 local time
The system SHALL compute whether a timestamp is inside the 08:00–22:00 window in a given IANA timezone and SHALL push a timestamp outside the window to the next 08:00 local time.

#### Scenario: Inside the window
- **WHEN** the candidate is 09:00 local
- **THEN** the allowed time equals the candidate

#### Scenario: Before the window
- **WHEN** the candidate is 06:45 local
- **THEN** the allowed time is 08:00 local the same day

#### Scenario: At the closing boundary
- **WHEN** the candidate is exactly 22:00 local
- **THEN** the allowed time is 08:00 local the next day

#### Scenario: Different zones, same instant
- **WHEN** the same UTC instant is 21:30 in `America/Sao_Paulo` and 20:30 in `America/Manaus`
- **THEN** it is allowed in both zones, and 30 minutes later it is allowed only in `America/Manaus`

### Requirement: Retry schedule follows the spec intervals measured from the actual attempt end
The system SHALL schedule a retry 15 minutes after the end of attempt 1 and 2 days after the end of attempt 2, measured from `ended_at` of the previous attempt, pushed into the allowed window, and SHALL return no retry after attempt 3.

#### Scenario: First retry
- **WHEN** attempt 1 ended at 10:00 local
- **THEN** the retry is scheduled for 10:15 local

#### Scenario: Second retry pushed into the window
- **WHEN** attempt 2 ended at 21:50 local on a Monday
- **THEN** the retry is scheduled for 08:00 local on Wednesday

#### Scenario: Interval measured from actual end, not planned start
- **WHEN** attempt 1 was scheduled for 10:00 but actually ended at 10:20
- **THEN** the retry is scheduled for 10:35

#### Scenario: No fourth attempt
- **WHEN** attempt 3 has ended
- **THEN** the scheduler returns `null` and the lead is eligible for `no_answer_final`

### Requirement: Retry schedule accepts an explicit requested time
The retry function SHALL accept an optional requested time (for a lead-requested callback) and, when provided, SHALL use it instead of the interval, still pushed into the allowed window.

#### Scenario: Requested time inside the window
- **WHEN** the lead asked to be called at 19:00 local and the interval would give 16:15
- **THEN** the retry is scheduled for 19:00 local

#### Scenario: Requested time outside the window
- **WHEN** the lead asked to be called at 23:00 local
- **THEN** the retry is scheduled for 08:00 local the next day

