## Why

Every part of the pipeline exists except the one the product is named for. Intake
writes `next_call_at`, the agent holds a full conversation, the worker scores the
transcript and the portal shows the result — but no telephone ever rings. A
simulated call is the only way to exercise the pipeline end to end today, and a
simulation proves the script, not the medium: a text loop has no latency, no
barge-in, no answering machine and no eight-kilohertz codec.

This change makes the call real. It is deliberately the second-to-last change:
the Twilio trial is roughly thirty-five two-minute calls, and everything that
could be de-risked without spending them already has been.

## What Changes

- **A new `packages/voice`** holding the transport-neutral half of a real call:
  the Gemini Live session driver, the audio conversion, and the timers. It is a
  package rather than code in `apps/web` because the fallback for the WebSocket
  beta is a Fastify host on Fly.io, and a fallback that requires rewriting the
  session is not a fallback.
- **A browser-microphone harness** that drives the same session with no Twilio
  at all. It lands first, so the Gemini Live half and the telephony half fail
  for separable reasons and neither is debugged with trial minutes.
- **Twilio dispatch**: an admin "Call now" action mirroring the existing
  simulated-call action, plus `POST /api/internal/call` for the workflow in
  change 5 to call. Both refuse an opted-out lead, an attempt already in flight,
  a lead outside its 08:00-22:00 window, a lead at the attempt cap and a lead
  with an unreviewed high-severity guardrail violation.
- **A Media Streams bridge** at `/api/media`: 8 kHz mu-law from Twilio to 16 kHz
  PCM16 for Gemini, 24 kHz PCM16 back to 8 kHz mu-law for Twilio, with a `clear`
  message on barge-in.
- **Two-phase attempt persistence.** A real attempt is written when the call is
  placed, keyed by `twilio_call_sid`, and completed when the call ends. No
  migration: `call_attempts` already carries the SID, a unique index on it,
  `started_at`, `ended_at`, `outcome` and `ended_reason`.
- **The Twilio status callback becomes the authority on how an attempt ended.**
  The media WebSocket is best-effort — it can die with the function — so the
  callback, which always fires, writes the outcome, persists the transcript the
  bridge accumulated and hands the attempt to the scoring worker.
- **A voice addendum to the guardrail frame**: speech-shaped output, the AI
  disclosure spoken before the lead is asked anything, no markdown or read-aloud
  lists. The guardrails themselves do not change or move.
- **The evaluation suite gains a voice pass**: the guardrail probes from change 3
  re-run against the voice model over a Live session, which change 3's design
  promised and did not deliver, because a green text suite does not certify the
  model that will actually speak.

Deterministic, unit-tested without any model: mu-law encode/decode, resampling,
frame accumulation, the call timers, the end-reason-to-outcome mapping, every
dispatch precondition, and the Twilio `AnsweredBy` and `CallStatus` mapping.
LLM-driven: the Live session itself, and nothing else this change adds. Scoring,
extraction, narrative and the judge are unchanged and still run on the
non-realtime model, satisfying spec section 4.6.

## Capabilities

### New Capabilities
- `telephony-dispatch`: what must be true before a lead is called, how the call
  is placed through Twilio with answering-machine detection, and how the attempt
  row that will receive the result is created.
- `voice-session`: the realtime conversation — the assembled script and tool
  declarations handed to Gemini Live, transcript capture from input and output
  transcription, the 90-second wrap-up and 3-minute hard stop, barge-in, and how
  the session decides the call is over.
- `audio-bridge`: the audio path between Twilio Media Streams and Gemini Live —
  codec conversion, resampling, framing, interruption handling and what happens
  when either socket closes.
- `call-completion`: the authoritative end of an attempt — the Twilio status
  callback, the outcome it resolves, the transcript it persists, the lifecycle
  transition it applies, the scoring it triggers, and the reconciliation of an
  attempt whose bridge died mid-call.
- `voice-harness`: exercising a real Gemini Live session from a browser
  microphone, with no telephony and without writing a lead attempt.

### Modified Capabilities
- `conversation-script`: the assembled prompt gains a voice medium whose frame
  adds speech rules and orders the AI disclosure before the first question. The
  existing guardrail frame and criteria assembly are unchanged.
- `lead-portal`: an admin can place a real call from the lead detail, sees why a
  call is refused when it is, and can tell a real attempt from a simulated one.
- `agent-evaluation`: the guardrail probes run against the voice model over a
  Live session, reported separately from the text suite.

## Impact

- **New package**: `packages/voice` (`@solarwave/voice`), depending on
  `@solarwave/agent`, `@solarwave/core` and `@google/genai`. Its barrel stays
  client-safe; anything touching `@solarwave/db` sits behind a subpath, per the
  rule change 3 learned the hard way.
- **New dependencies**: `@google/genai` (realtime only — text stays on
  `@ai-sdk/google`), `twilio`, `@vercel/functions`, `ws` types.
- **New routes** in `apps/web`: `POST /api/twilio/voice` (TwiML), `POST
  /api/twilio/status` (status callback), `GET /api/media` (the WebSocket
  upgrade), `POST /api/internal/call`, and a harness page under `/portal`.
- **New `vercel.json`** — the project has none. Needed for `maxDuration` on the
  media route and to confirm Fluid Compute.
- **`packages/db`**: `createDispatchedAttempt`, `finishAttempt`,
  `findAttemptByCallSid`, `reconcileStaleAttempts`. No schema migration.
- **`packages/agent`**: the end-reason-to-outcome mapping and the live-answer
  bookkeeping move out of `loop.ts` into a transport-neutral module the text
  loop and the voice session both use. Behaviour unchanged; `loop.ts` keeps its
  turn budget, which is text-only.
- **Environment**: Twilio credentials and number, a public base URL for
  webhooks, the Live model id, the call timers and a shared secret for the
  internal dispatch route. Documented in `apps/web/.env.example`.
- **Spec sections touched**: 4.3 (the bridge places the call and connects audio
  to Gemini Live), 4.4 (the agent follows the script and holds the guardrails),
  4.5 (a call that ends before enough information retries like a no-answer),
  4.7 (attempt and transcript persisted), 6 (every guardrail, now over voice),
  9 (the voice bridge component), 10 (audio is never stored).
- **Not touched**: the scoring worker, extraction, the narrative, the guardrail
  judge, the criteria model and the intake API.

## Non-goals

- **`leadWorkflow` and automatic dispatch.** Change 5. This change places calls
  on demand and exposes the internal route the workflow will drive; it never
  schedules one itself. `workflow_run_id` stays unwritten.
- **Acting on a requested callback time.** `request_callback` still captures the
  time verbatim and the attempt still ends as `answered_incomplete`. Persisting
  that time and letting it override the 15-minute / 2-day policy is change 5,
  where `scheduleRetry` already accepts an explicit requested time.
- **The transcript purge and the Supabase keep-alive crons.** Change 5.
- **Storing call audio.** Spec section 10 forbids it. The bridge holds audio in
  flight and writes only the transcript.
- **Leaving voicemail.** A detected answering machine ends the call; the retry
  policy handles the rest.
- **Inbound calls.** Outbound qualification only.
- **Calling anyone but a verified test number.** The decision log's rule stands:
  never call real customers with real data in a demo.
