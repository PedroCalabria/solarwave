## ADDED Requirements

### Requirement: Audio is converted between the telephony and model formats without drift
The system SHALL convert telephony audio (8 kHz mu-law) to the format the
realtime model accepts, and the model's output audio back to 8 kHz mu-law, in
both directions, as pure functions that take and return buffers and perform no
I/O. Conversion state SHALL carry across frames so that a long call does not
accumulate sample drift or a discontinuity at frame boundaries.

#### Scenario: Round trip preserves the signal
- **WHEN** a known waveform is encoded to mu-law and decoded back
- **THEN** the result matches the original within the codec's defined tolerance

#### Scenario: No drift across many frames
- **WHEN** one thousand consecutive frames are resampled through the same converter
- **THEN** the total number of output samples matches the expected count for the total input duration

#### Scenario: Frame boundaries are continuous
- **WHEN** a continuous tone is resampled as two separate frames
- **THEN** the concatenated output contains no discontinuity at the boundary

### Requirement: The sample rates are read from the model, not assumed
The conversion SHALL be configured with the input and output sample rates the
realtime model actually declares, and those rates SHALL be recorded in
configuration rather than hard-coded from documentation, so a model whose format
differs is a configuration change and not a silent pitch error on a live call.

#### Scenario: A different output rate is handled
- **WHEN** the model is configured with an output sample rate other than the default
- **THEN** the audio returned to the telephony provider is still 8 kHz mu-law at the correct pitch

### Requirement: The media stream is authenticated before any audio flows
The media socket SHALL require a short-lived signed token, bound to the call it
belongs to, supplied as a stream parameter when the call instructions are
generated. A connection whose token is missing, expired, malformed, or bound to a
different call SHALL be closed before any audio is exchanged and before any
model session is opened.

#### Scenario: A forged stream is rejected
- **WHEN** a media connection arrives without a valid token
- **THEN** the connection is closed, no model session is opened, and no attempt row is touched

#### Scenario: A token bound to another call is rejected
- **WHEN** a media connection presents a token minted for a different call SID
- **THEN** the connection is closed and no audio is exchanged

### Requirement: Barge-in flushes buffered audio and marks the interrupted turn
When the model reports that its output was interrupted by the lead speaking, the
bridge SHALL instruct the telephony provider to discard audio it has buffered but
not yet played, so the agent stops talking promptly. The transcript turn that was
interrupted SHALL be retained in full and marked as interrupted rather than
dropped or truncated, so text the model produced remains visible to the post-call
guardrail audit.

#### Scenario: The agent stops when the lead speaks
- **WHEN** the model reports an interruption while agent audio is buffered
- **THEN** the bridge sends the provider a clear instruction and stops forwarding that turn's audio

#### Scenario: An interrupted turn is still auditable
- **WHEN** an agent turn is interrupted mid-sentence
- **THEN** the transcript keeps the full transcribed turn, marked as interrupted, and the guardrail audit can read it

### Requirement: Either socket closing ends the call cleanly
If the telephony socket closes, the bridge SHALL close the model session; if the
model session closes or errors, the bridge SHALL end the call. In both cases the
bridge SHALL persist what it has accumulated before closing, and SHALL NOT be the
component that decides the attempt's final outcome.

#### Scenario: The caller hangs up
- **WHEN** the telephony socket closes while the model session is open
- **THEN** the model session is closed and the accumulated transcript is persisted

#### Scenario: The model session fails
- **WHEN** the model session errors mid-call
- **THEN** the call is ended, the accumulated transcript is persisted, and the attempt's outcome is left for the call-completion path to decide

### Requirement: Audio exists only in flight
The bridge SHALL hold audio only for as long as it takes to convert and forward
it. It SHALL NOT write audio to disk, to the database, or to any external
storage, in either direction (spec section 10).

#### Scenario: Nothing is stored
- **WHEN** a full call is bridged
- **THEN** no audio artefact exists in the database, in object storage, or on the filesystem afterwards
