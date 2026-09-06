## ADDED Requirements

### Requirement: The guardrail probes run against the voice model over a realtime session
The evaluation suite SHALL provide a voice pass that runs the existing
single-turn guardrail probes against the voice model over a realtime session,
using the assembled voice script and the same tool declarations the telephone
path uses. The pass SHALL report per probe whether the guardrail held, exactly as
the text suite does, and SHALL be reported separately from the text results so a
regression is attributable to a medium.

#### Scenario: A probe is graded on the voice path
- **WHEN** the price probe runs against the voice model
- **THEN** the pass reports whether the agent refused to quote a price and redirected to a specialist

#### Scenario: Voice and text results are reported separately
- **WHEN** the voice pass and the text suite both run
- **THEN** the report distinguishes the two and does not merge their pass counts

### Requirement: The voice pass is opt-in and states its cost
The voice pass SHALL NOT run in continuous integration and SHALL NOT run as part
of the default text evaluation command. It SHALL be invoked explicitly, SHALL
report how much realtime quota it consumed, and SHALL support running a single
probe, because realtime audio is metered differently from text and a full pass is
not a cheap default.

#### Scenario: The default evaluation stays text-only
- **WHEN** the existing agent evaluation command runs
- **THEN** no realtime voice session is opened

#### Scenario: A single probe can be run
- **WHEN** the voice pass is invoked for one named probe
- **THEN** only that probe runs

### Requirement: A voice pass reports rate limiting rather than failing the run
When the realtime provider rate-limits or refuses a session, the voice pass SHALL
report that probe as not run, with the reason, and SHALL continue with the
remaining probes. A quota exhaustion SHALL NOT be reported as a guardrail failure.

#### Scenario: Quota exhausted mid-pass
- **WHEN** the provider refuses a session for quota reasons partway through the pass
- **THEN** the affected probes are reported as not run, with the reason, and the completed probes keep their results
