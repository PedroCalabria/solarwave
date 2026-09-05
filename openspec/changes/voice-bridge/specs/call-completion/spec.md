## ADDED Requirements

### Requirement: The provider's status callback is authoritative for how an attempt ended
The system SHALL treat the telephony provider's call status callback as the
component that closes a call attempt. It SHALL set `ended_at`, the outcome and
the end reason, SHALL persist the transcript the bridge accumulated, and SHALL
apply the lifecycle transition for that outcome. The media bridge SHALL NOT be
the component that writes an attempt's ending, because it can terminate without
running any further code.

#### Scenario: A normal call is closed by the callback
- **WHEN** the status callback reports a completed call for a known call SID
- **THEN** the attempt is closed with an outcome, the transcript is persisted, and the lead transition for that outcome is applied

#### Scenario: The bridge never ran
- **WHEN** the status callback reports a call whose media stream never connected
- **THEN** the attempt is still closed, with a retryable outcome, and the lead is not left in `calling`

### Requirement: The webhooks are authenticated before they are trusted
The status callback endpoint and the call-instruction endpoint SHALL authenticate
every request before acting on it. Authentication SHALL NOT depend on the
provider's request signature alone, because that signature is computed with the
account auth token and this system authenticates with an API key which cannot
verify one. Each webhook URL SHALL therefore carry a token, signed by this
system and bound to the specific call attempt, minted when the call is placed.
The provider's signature SHALL additionally be verified whenever an account auth
token is configured. A request that fails any configured check SHALL be rejected
without closing an attempt, writing a transcript or triggering scoring.

#### Scenario: A forged callback changes nothing
- **WHEN** a request arrives at the status callback endpoint with no token or an invalid one
- **THEN** it is rejected, no attempt is modified, and no scoring runs

#### Scenario: A token minted for another attempt is refused
- **WHEN** a request carries a validly signed token bound to a different attempt
- **THEN** it is rejected

#### Scenario: An expired token is refused
- **WHEN** a request carries a token whose expiry has passed
- **THEN** it is rejected

#### Scenario: The provider signature is checked when it can be
- **WHEN** an account auth token is configured and a request carries a valid token but an invalid provider signature
- **THEN** it is rejected

### Requirement: Call status and machine detection resolve to an attempt outcome
The system SHALL map the provider's reported call status and answering-machine
detection result to an attempt outcome deterministically: an unanswered call to
`no_answer`, a busy line to `busy`, a provider failure to `failed`, a detected
machine or fax to `voicemail`, and an answered human call to the outcome the
voice session resolved. A detection result of unknown SHALL be treated as a
human. The mapping SHALL be a pure function, testable without any network call.

#### Scenario: Machine detected
- **WHEN** the callback reports the call was answered by a machine
- **THEN** the attempt outcome is `voicemail` and no message is left

#### Scenario: Unknown detection is treated as a human
- **WHEN** the callback reports the answering party as unknown
- **THEN** the call proceeds as a human call rather than being recorded as `voicemail`

#### Scenario: Busy and failed
- **WHEN** the callback reports a busy line or a provider failure
- **THEN** the attempt outcome is `busy` or `failed` respectively and the retry policy applies

#### Scenario: An answered call uses the session's outcome
- **WHEN** the callback reports an answered human call and the session resolved `answered_complete`
- **THEN** the attempt outcome is `answered_complete`

### Requirement: An answered call that produced nothing usable retries like a no-answer
When a call connected but the session resolved no usable end — because the bridge
died, the model session failed, or the hard stop cut an unclosed call — the
attempt SHALL be recorded as `answered_incomplete`, which the lifecycle already
treats as a retryable outcome (spec section 4.5).

#### Scenario: The bridge died mid-call
- **WHEN** a call connected, the bridge terminated before resolving an end reason, and the callback closes the attempt
- **THEN** the outcome is `answered_incomplete` and the lead is scheduled for a retry or reaches `no_answer_final` at the cap

### Requirement: Closing an attempt is idempotent
Closing an attempt SHALL be safe to attempt more than once. A repeated callback
for the same call SID SHALL NOT create a second attempt, apply a second lifecycle
transition, overwrite a resolved outcome, or run scoring twice.

#### Scenario: The provider retries the callback
- **WHEN** the same status callback is delivered twice for one call SID
- **THEN** the attempt is closed once and scoring runs once

### Requirement: A closed attempt is handed to the scoring worker
After an attempt is closed with an outcome that produced a transcript, the system
SHALL run the existing scoring worker over that attempt, exactly as a simulated
call does. Scoring SHALL apply the qualification transition itself from the real
score; the completion path SHALL NOT invent a qualification decision. A scoring
failure SHALL leave the attempt and the lead where they are, with the failure
recorded, and SHALL NOT discard the transcript.

#### Scenario: A completed call is scored
- **WHEN** an attempt is closed with outcome `answered_complete`
- **THEN** the scoring worker runs over that attempt and the qualification decision comes from the score

#### Scenario: Scoring fails after a real call
- **WHEN** scoring fails for a closed attempt
- **THEN** the attempt keeps its transcript and outcome, the failure is recorded, and the lead is not qualified or disqualified

### Requirement: Attempts left open past the budget are reconciled
The system SHALL provide an operation that finds attempts still open past the
hard stop plus a margin and closes them as `answered_incomplete`, applying the
retry transition. This SHALL exist as a backstop for a status callback that never
arrives, so no lead can be permanently blocked by an attempt that appears to be
in flight.

#### Scenario: An abandoned attempt is recovered
- **WHEN** an attempt has been open for longer than the hard stop plus the margin and no callback has closed it
- **THEN** reconciliation closes it as `answered_incomplete` and the lead becomes eligible for its next attempt

#### Scenario: An in-budget call is not disturbed
- **WHEN** an attempt has been open for less than the hard stop
- **THEN** reconciliation leaves it alone
