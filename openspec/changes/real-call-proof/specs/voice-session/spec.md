## ADDED Requirements

### Requirement: A realtime session can record a timestamped provider event log
The realtime session SHALL be able to record every event it receives from the
realtime provider as an ordered entry carrying the event type, a timestamp and
the size of any payload, so that the order in which `interrupted`,
`turn_complete`, transcription and audio events arrived around a stall can be
read rather than inferred. The log SHALL also record the events the session
sends, so a wrap-up injection can be placed against the model's generation state.

#### Scenario: The order of events around an interruption is recoverable
- **WHEN** the session receives audio, then an interruption, then a turn
  completion, with the log enabled
- **THEN** the log holds three entries in that order, each with a timestamp

#### Scenario: A wrap-up injection is placed against the generation state
- **WHEN** the session injects the wrap-up instruction with the log enabled
- **THEN** the log holds an entry for the injection, ordered against the provider
  events that preceded it

### Requirement: The event log never records speech, audio or transcribed words
The event log MUST NOT contain audio bytes, transcribed text, tool call arguments
or any other content of the conversation. For an audio event it SHALL record the
byte count and nothing else; for a transcription event it SHALL record that one
arrived and nothing else. Spec section 10 forbids storing call audio, and a debug
log is not an exception to it.

#### Scenario: An audio event is logged without its bytes
- **WHEN** an audio event carrying model speech is logged
- **THEN** the entry records the event type, the timestamp and the byte count,
  and contains none of the audio

#### Scenario: A transcription event is logged without its words
- **WHEN** an input or output transcription event is logged
- **THEN** the entry records that a transcription arrived and contains none of
  the transcribed text

### Requirement: The event log is off by default and enabled only by explicit configuration
The session SHALL NOT record a provider event log unless a debug flag is
explicitly enabled in the environment. With the flag absent or unset the session
SHALL behave exactly as it does today, allocating no log and emitting no debug
output, so that a deployed call carries no debugging side effect.

#### Scenario: Default configuration records nothing
- **WHEN** a session runs with the debug flag unset
- **THEN** no event log is produced and the session's behaviour is unchanged

#### Scenario: The flag is explicit
- **WHEN** the debug flag is set to an enabling value
- **THEN** the session records the event log for the duration of that session
