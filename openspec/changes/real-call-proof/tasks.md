## 0. Where this work came from, and the two budgets it spends

Twenty-four tasks moved here from `voice-bridge`, which archived as software and
not as telephony. Nothing below is code that is missing; it is measurement
against two externally controlled budgets, plus one piece of instrumentation
that exists to make a failed measurement legible.

Two decisions are already made and are not re-opened by any task here:

- **No execution costs** (project owner, 2026-09-06). No paid Gemini realtime
  tier, no paid Twilio number, no Brazilian regulatory bundle. This closes
  `voice-bridge` tasks 3.3 and 7b.5 by decision.
- **The stop condition** (design D5): if the realtime allowance does not reset
  into a usable shape, section 4 is not attempted at all. Twilio minutes are not
  spent to rediscover a Gemini limit.

Run order is deliberate: diagnose the free budget first (section 1), settle the
account second (section 2), instrument third (section 3), then spend telephony
once, with everything watching (section 4).

## 1. Diagnose the realtime allowance — one session, and it decides the change

- [ ] 1.1 FIRST, and it costs exactly one session (design D1): run
  `pnpm --filter @solarwave/voice spike:live` alone, after a suspected reset. It
  is independent code that produced 182 audio chunks, a full Portuguese
  transcription and a tool call on the morning of 2026-09-05 and returned nothing
  that afternoon. If it produces audio again, the allowance resets and every
  measurement taken late on 2026-09-05 is VOID. If it does not, section 4 is off
- [ ] 1.2 Record the shape of the allowance in `openspec/config.yaml`: whether it
  resets, on what period, and how many sessions it sustains before degrading. The
  decision log currently says "roughly forty sessions had been opened" and cannot
  say more than that, which is not enough to plan a demo around
- [ ] 1.3 Only if 1.1 produced audio: establish whether the harness intermittency
  survives headphones, in a quiet room, with the 40 ms frames. This is the
  acoustic-echo suspicion, and it has never actually been tested on a fresh
  allowance — every run that looked like echo was taken after the degradation set in
- [ ] 1.4 Only if 1.1 produced audio: run a session with the wrap-up disabled
  (`VOICE_WRAP_UP_SECONDS` beyond the hard stop) and see whether it survives past
  121 s. One harness session died at exactly 121 s with `1011 INTERNAL ERROR
  OCCURRED`, which is consistent with the injection racing the model's generation
- [ ] 1.5 Re-run `pnpm eval:voice` and record a usable measurement. THIRTEEN of
  thirteen guardrail probes have still never been graded against the voice model:
  the 4-second pass held four, the 30-second pass held zero, and the pacing theory
  that explained the first was disproved by the second
- [ ] 1.6 Hold a full conversation through `/portal/harness` against the real Live
  model in BOTH `pt` and `en`, and record what it cost in quota. NEEDS A HUMAN AND
  A MICROPHONE. This is the first end-to-end proof of the voice half and it spends
  no telephony. It is also where input-audio transcription is verified for the
  first time against real speech — the spike sent text, so the lead half of the
  transcript has never been exercised

## 2. Settle the Twilio account, or record that it cannot be settled

- [ ] 2.1 Confirm whether the demo destination is a verified caller ID. The API
  reports ZERO verified caller IDs on this account even though the console's own
  trial panel lists the number, and the two readings have to be reconciled before
  anything is dialled
- [ ] 2.2 Attempt the verification call and observe whether it ARRIVES. On
  2026-09-06 Twilio dialled a Brazilian mobile and rang for 55 s while the handset
  never rang — `no-answer`, duration 0, no charge. If the verification call does
  not arrive either, the Brazilian carrier is filtering the US trial number and no
  code in this repository changes that
- [ ] 2.3 Place one manual test call from the Twilio console and measure the trial
  announcement: its presence, its length in seconds, and how much of the
  two-minute conversation budget it eats. It plays before the AI disclosure, so
  record that the disclosure is still the agent's first utterance
- [ ] 2.4 DECISION under the no-cost constraint (design D4): if 2.2 says the
  carrier filters, the demo's evidence moves to the browser harness and simulated
  calls. Record the choice, the reasoning and the remaining voice-minute budget in
  `openspec/config.yaml` — a blocked account is a deliverable, not a stall
- [ ] 2.5 Confirm the Twilio and voice environment variables are present in the
  VERCEL project, not only in `apps/web/.env.example` and `.env.local`. This is
  the half of `voice-bridge` 3.4 that the repository cannot verify, and a deployed
  webhook is what needs it

## 3. The provider event log — the only code in this change

- [ ] 3.1 Add a timestamped provider event log to the realtime session behind one
  environment flag, off by default: event type, timestamp, payload byte count for
  audio, and the events the session SENDS as well, so the wrap-up injection can be
  placed against the model's generation state (design D2)
- [ ] 3.2 Enforce the content rule in code, not in a comment: no audio bytes, no
  transcribed words, no tool call arguments. Spec section 10 forbids storing call
  audio and a debug log is not an exception to it
- [ ] 3.3 Unit-test all three requirements against the existing fake transport: the
  order of events around an interruption is recoverable, an audio event logs its
  byte count and none of its bytes, and an unset flag allocates no log and changes
  no behaviour
- [ ] 3.4 Document the flag in `apps/web/.env.example` with its default and a line
  saying what it is for, and run `pnpm build` — the only check that exercises the
  server/client module boundary

## 4. The proof run — twelve claims, one call each where possible

Blocked by section 1's stop condition. Design D3: the run is one call and the
record is twelve claims settled individually, because a call that connects,
converses and then loses its status callback has proven eight things and failed
one, and a single checkbox would report that as failure.

- [ ] 4.1 Place one real qualification call to the verified demo number, with the
  event log enabled, and record the result claim by claim in 4.2 through 4.10
- [ ] 4.2 `/api/twilio/voice` returns TwiML that Twilio ACCEPTS. Ours is
  well-formed and unit-tested, and Twilio has never fetched it
- [ ] 4.3 Twilio actually upgrades `/api/media`. Our own probe did; a
  `<Connect><Stream>` from Twilio is a different client
- [ ] 4.4 The audio conversion works on a real 8 kHz mu-law stream in both
  directions. The tests use synthetic tones, and a pitch or framing error is
  inaudible to them and obvious on a telephone
- [ ] 4.5 The conversation holds over the telephone: the agent speaks first with
  the AI disclosure, hears the lead, and records answers
- [ ] 4.6 Barge-in reaches Twilio: the `clear` frame actually stops audio the
  provider had already buffered
- [ ] 4.7 The mid-call transcript write happens, so a bridge that dies leaves the
  conversation behind
- [ ] 4.8 `recordSessionResult` hands the session outcome to the status callback,
  and the callback prefers it over the line status
- [ ] 4.9 Scoring runs from a real attempt and the criteria score lands in the
  portal. NOTE: the extraction half is ALREADY proven by the simulated call —
  100/100 with verbatim evidence on both criteria — so what a real call adds here
  is only that a phone transcript feeds it
- [ ] 4.10 The trial announcement's measured length against the conversation
  budget, cross-checked with 2.3
- [ ] 4.11 Place a deliberate opt-out call and confirm the lead reaches terminal
  `opt_out`, the attempt outcome is `opt_out`, and a re-submission of the intake
  form does NOT reschedule that phone. This is spec section 6's highest-priority
  guardrail and the only one whose failure is irreversible for a real person
- [ ] 4.12 Kill the bridge mid-call on purpose and confirm the status callback
  still closes the attempt, the transcript survives, and the lead is retryable
  rather than stuck in `calling`. This is design D4 of `voice-bridge` under the
  condition it was written for

## 5. The write-up, including the negative one

- [ ] 5.1 Record every measurement in `openspec/config.yaml` the way changes 3 and
  4 did: the allowance's shape, the announcement's cost, the remaining voice-minute
  budget, and which of the twelve claims are settled
- [ ] 5.2 Update `README.md` so "State of the build" stops saying the voice path is
  not yet proven on a telephone — one way or the other. If the free tiers did not
  permit a connected call, say that, name the harness and simulated calls as what
  the demo shows, and do not imply a telephone
- [ ] 5.3 List whatever remains unproven when the change ends, with the reason. An
  unmeasured claim about a voice agent is the claim this change exists to stop
  making
