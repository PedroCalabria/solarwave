# lead-intake Specification

## Purpose
TBD - created by archiving change persistent-foundations. Update Purpose after archive.
## Requirements
### Requirement: Intake validates and normalises the submission
The intake API SHALL accept `name`, `phone`, `email` and `preferredCallLanguage`, reject invalid payloads with field-level errors, normalise the phone to E.164 with Brazil as the default region, and default the call language to `pt` when missing or unrecognised.

#### Scenario: Valid Brazilian mobile number in national format
- **WHEN** a client posts `phone = "(11) 98842-1170"` with a valid name and email
- **THEN** the lead is stored with `phone = "+5511988421170"`, `ddd = "11"`, `timezone = "America/Sao_Paulo"`

#### Scenario: Non-Brazilian number is rejected in phase 1
- **WHEN** a client posts `phone = "+1 512 555 0148"`
- **THEN** the API responds `422` with a `phone` field error and no lead is created

#### Scenario: Unrecognised call language falls back to Portuguese
- **WHEN** a client posts `preferredCallLanguage = "es"`
- **THEN** the lead is stored with `preferred_call_language = "pt"`

#### Scenario: Missing or malformed fields
- **WHEN** a client posts a name shorter than 3 characters or an email without `@`
- **THEN** the API responds `422` listing each failing field

### Requirement: Intake requires a valid CAPTCHA token
The intake API MUST verify a Cloudflare Turnstile token server-side before any database access and MUST reject submissions whose token is missing or invalid.

#### Scenario: Missing token
- **WHEN** a client posts a lead without a `turnstileToken`
- **THEN** the API responds `400` and no database write occurs

#### Scenario: Invalid token
- **WHEN** Turnstile verification returns `success = false`
- **THEN** the API responds `403` and no database write occurs

### Requirement: Intake is rate limited per client without in-memory state
The intake API SHALL allow at most 5 submissions per client IP per 60-second window, tracked in the database so the limit survives restarts and spans instances.

#### Scenario: Sixth submission in a window
- **WHEN** the same IP posts a sixth valid submission within 60 seconds
- **THEN** the API responds `429` and no lead is created

#### Scenario: Limit survives a process restart
- **WHEN** an IP has 5 submissions recorded and the server process restarts within the window
- **THEN** the next submission from that IP still responds `429`

### Requirement: Deduplication by phone is atomic
The intake API SHALL treat the normalised phone as the deduplication key using the unique index, SHALL never read-then-write, and SHALL return the existing lead untouched when the phone already exists.

#### Scenario: New phone
- **WHEN** a submission arrives for a phone with no existing lead
- **THEN** a lead is inserted with `status = new` and the API responds `201` with `status: "created"` and the lead id

#### Scenario: Existing phone
- **WHEN** a submission arrives for a phone that already has a lead
- **THEN** no new lead is inserted, the existing lead's fields and `next_call_at` are unchanged, and the API responds `200` with `status: "existing"`

#### Scenario: Two simultaneous submissions for the same phone
- **WHEN** two requests with the same normalised phone are processed concurrently
- **THEN** exactly one lead row exists afterwards and both requests succeed

### Requirement: Opted-out phones are never re-scheduled
Per spec section 6 opt-out priority, a submission for a phone whose lead has status `opt_out` MUST NOT create a lead, change its status or set a `next_call_at`.

#### Scenario: Opted-out lead submits the form again
- **WHEN** a submission arrives for a phone whose lead is `opt_out`
- **THEN** the lead stays `opt_out` with `next_call_at = null` and the API responds `200` with `status: "existing"`

### Requirement: First attempt is scheduled inside the allowed window
On insert the intake API SHALL set `next_call_at` to the earliest time at or after now that falls within 08:00–22:00 in the lead's timezone, and SHALL NOT dispatch any call.

#### Scenario: Submission during the window
- **WHEN** a lead in `America/Sao_Paulo` submits at 14:30 local time
- **THEN** `next_call_at` equals the submission time

#### Scenario: Submission after 22:00
- **WHEN** a lead in `America/Manaus` submits at 23:10 local time
- **THEN** `next_call_at` is 08:00 local time of the next day in `America/Manaus`

#### Scenario: No call is placed by intake
- **WHEN** a lead is created
- **THEN** no call attempt row exists and no external telephony call is made

