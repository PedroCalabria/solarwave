## ADDED Requirements

### Requirement: A lead-requested callback time is used only when it is usable
When a lead asks to be called at another time, the system SHALL use that time in
place of the interval retry only when it is in the future, no further ahead than a
bounded horizon, and after the usual clamp into the 08:00–22:00 window of the
lead's timezone. When any of those fails, the interval policy of spec section 4.5
SHALL stand unchanged.

#### Scenario: A usable requested time replaces the interval
- **WHEN** attempt 1 ended at 10:00 local and the lead asked to be called at 19:00
  the same day
- **THEN** the retry is scheduled for 19:00 local rather than 10:15

#### Scenario: A requested time outside the window is clamped, not discarded
- **WHEN** the lead asked to be called at 23:00 local
- **THEN** the retry is scheduled for 08:00 local the next day

#### Scenario: A requested time in the past falls back to the interval
- **WHEN** the resolved requested time is earlier than the end of the attempt
- **THEN** the interval policy applies and the requested time is not used

#### Scenario: A requested time beyond the horizon falls back to the interval
- **WHEN** the resolved requested time is further ahead than the permitted horizon
- **THEN** the interval policy applies and the requested time is not used

#### Scenario: No requested time behaves exactly as before
- **WHEN** no callback time was resolved for the attempt
- **THEN** the retry is scheduled by the 15-minute and 2-day intervals with no
  change in behaviour

### Requirement: A requested callback never revives a lead that must not be called
A requested callback time MUST NOT reschedule a lead in a terminal status, and
MUST NEVER reschedule a lead that has opted out. Per spec section 6, opt-out
outranks every other instruction the lead gave during the same call.

#### Scenario: Opt-out outranks a callback request in the same call
- **WHEN** a lead asks to be called back later and then asks not to be contacted
  again
- **THEN** the lead becomes `opt_out` and no callback is scheduled

#### Scenario: A terminal lead is not rescheduled
- **WHEN** a callback time resolves for an attempt on a lead that has since become
  `qualified`, `disqualified` or `no_answer_final`
- **THEN** no next call time is set

### Requirement: What the lead said is kept alongside what the machine resolved
The system SHALL store the lead's requested callback verbatim as it was captured
during the call, in addition to any resolved instant, so that a person can always
see what was asked for and what was done with it. The verbatim value SHALL be kept
even when no usable instant could be resolved.

#### Scenario: An unresolvable phrase is still visible
- **WHEN** the lead said something that resolved to no usable time
- **THEN** the verbatim request is stored and the interval policy applies

#### Scenario: The resolved time is stored beside the phrase
- **WHEN** a usable time is resolved
- **THEN** both the verbatim request and the resolved instant are stored on the
  attempt
