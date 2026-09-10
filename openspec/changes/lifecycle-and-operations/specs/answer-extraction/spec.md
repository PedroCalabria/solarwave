## ADDED Requirements

### Requirement: The extraction pass resolves a requested callback time from the transcript
The extraction pass that reads a transcript for criteria answers SHALL also
resolve, in the same model call, any time the lead asked to be called back,
expressed as an instant in the lead's timezone. It SHALL NOT be a separate model
call, because a second call is a second failure mode for information the first
call is already reading.

#### Scenario: A stated time is resolved
- **WHEN** the transcript contains the lead asking to be called tomorrow morning
- **THEN** the extraction returns a resolved instant in the lead's timezone
  alongside the criteria answers

#### Scenario: The resolution is relative to the call, not to the extraction
- **WHEN** the lead says "tomorrow" during a call
- **THEN** the resolved instant is relative to when the call happened

### Requirement: An absent callback time is the normal case, not a failure
The requested callback field SHALL be optional, and its absence MUST NOT fail the
extraction, degrade the criteria answers or be reported as an error. Most calls
contain no callback request, and the conversation model has been measured omitting
fields it was asked to provide.

#### Scenario: A transcript with no callback request
- **WHEN** the transcript contains no request to be called back
- **THEN** the extraction returns the criteria answers and no callback time, and
  reports no error

#### Scenario: An unparseable request does not fail the pass
- **WHEN** the lead's request cannot be resolved to an instant
- **THEN** the extraction returns the criteria answers and no resolved time

### Requirement: The scoring worker applies a resolved callback time under the scheduling policy
After extraction, the scoring worker SHALL apply a resolved callback time to the
lead's next call time using the same retry function every other attempt uses, and
only when the scheduling policy accepts it. Applying it here rather than in the
scheduler is deliberate: scoring runs whether or not automatic dispatch is
enabled.

#### Scenario: The next call time moves to the requested time
- **WHEN** a usable callback time is resolved for a lead awaiting a retry
- **THEN** the lead's next call time becomes the scheduled requested time rather
  than the interval time

#### Scenario: A lead that must not be called is not rescheduled
- **WHEN** a callback time resolves for a lead that has opted out or reached a
  terminal status
- **THEN** no next call time is written

#### Scenario: Applying it twice changes nothing
- **WHEN** scoring is re-driven for the same attempt
- **THEN** the resulting next call time is the same as the first run produced
