## Why

`voice-bridge` archived as software and not as telephony. Every line of the
voice path is written, built and tested; no telephone has ever carried a
conversation through it. Twenty-four of its tasks moved here, and not one of
them is code that is missing:

| What is missing | Tasks |
| --- | --- |
| A CONNECTED call — nothing else can settle these | 12 |
| A Gemini realtime allowance this account exhausted | 5 |
| A Twilio number and a verified caller ID | 3 |
| Spending decisions | 2 |
| A marker, and one piece of instrumentation | 2 |

This change runs LAST, after `lifecycle-and-operations`, because that is where
the project owner put it on 2026-09-05 and because the ordering is right: a
scheduler that dispatches automatically must exist before the proof run can
exercise the path a real lead actually takes.

The change also exists to make a negative result respectable. Two free tiers
stand between this repository and a ringing telephone, and neither is under our
control. If they do not permit a connected call, the honest deliverable is a
written account of exactly what the free tiers allow, with the demo running on
the browser harness and simulated calls — not a paid upgrade, and not silence.

## What Changes

- **The account preconditions get settled, or recorded as unsettleable.** A
  Twilio number to call FROM and a verified caller ID to call TO, both from the
  console; and a Gemini realtime allowance that sustains one session. The API
  reports zero verified caller IDs on an account whose own console panel lists
  the number, and a Brazilian mobile never rang on the one attempt made. That is
  a carrier or verification problem, and it is diagnosed here.
- **One code addition: a provider event log behind a debug flag.** Every
  realtime provider event with a timestamp, off by default, never containing
  audio. It is the only thing in this change that is not a measurement, and it
  moved here rather than staying in `voice-bridge` because it exists to explain
  the call it sits next to. Section 7b's three surviving suspicions — acoustic
  echo, the 90-second wrap-up injection, free-tier exhaustion — are currently
  separated by inference, and a timestamped event order separates them by
  evidence.
- **The proof run**: one qualification call, one deliberate opt-out call, one
  call whose bridge is killed mid-conversation. Twelve claims that only a
  connected call can settle, each listed individually so a partial success is
  reportable as a partial success.
- **The write-up**, including the negative one. What the free tiers actually
  permitted, how much of the 75-minute Twilio budget the trial announcement
  eats, and which of the twelve claims are still unproven when the change ends.

Deterministic and unit-testable: the event log's redaction and its off-by-default
behaviour. Everything else in this change is a measurement against a live
external account, which is precisely why it is a change of its own rather than
tasks inside another one.

## Capabilities

### Modified Capabilities
- `voice-session`: the session can record a timestamped log of provider events
  behind a debug flag, off by default, carrying no audio and no lead speech.

No new capabilities. This change proves capabilities that `voice-bridge` already
specified; a proof is not a capability.

## Impact

- **`packages/voice`**: the event log in the session and its transport, plus
  unit tests against the existing fake transport. No new dependency.
- **Environment**: one debug flag, documented in `apps/web/.env.example`.
- **`openspec/config.yaml`**: the measured result — what the free tiers permit,
  the remaining call budget, and whether the demo runs on a telephone or on the
  harness.
- **`README.md`**: "State of the build" stops saying "not yet proven on a
  telephone", one way or the other.
- **Spec sections touched**: 4.3, 4.4, 4.5, 4.7, 6 and 10, none of them
  rewritten — this change observes them over a real medium.
- **Not touched**: scoring, extraction, the narrative, the judge, criteria,
  intake, and the lifecycle workflow.

## Non-goals

- **Any paid tier.** SETTLED by the project owner on 2026-09-06: this
  demonstration incurs no execution costs. That closes tasks 3.3 and 7b.5 by
  decision rather than by pricing exercise, and it removes a paid Gemini
  realtime tier, a paid Twilio number and a Brazilian regulatory bundle from the
  options. If the free tiers cannot carry a connected call, the demo runs on the
  harness and this change says so.
- **A Brazilian Twilio number.** Every BR local number carries
  `address_requirements=local`, which means a regulatory bundle and a review
  period, and it is not free. Out by the constraint above.
- **Fixing the realtime model's latency.** A single turn takes tens of seconds
  on the free tier. That is measured, it is the tier, and no code in this
  repository changes it.
- **Calling anyone but a verified test number.** The decision log's rule stands.
- **Storing call audio**, leaving voicemail, and inbound calls — all still out,
  as in `voice-bridge`.
- **Re-proving what a simulated call already proves.** Extraction, scoring, the
  narrative and the judge are proven end to end on a real attempt row. What a
  telephone adds is that a phone transcript feeds them.
