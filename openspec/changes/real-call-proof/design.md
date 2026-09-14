## Context

`voice-bridge` ended with a precise, uncomfortable inventory: the software is
finished and twelve claims about it have never been observed. This change owns
those claims. It is small in code and almost entirely a sequencing problem,
because its work is spending two scarce, externally controlled budgets in the
order that yields the most information per unit spent.

Three constraints shape every decision below, and two of them are new since
`voice-bridge` was designed.

**No execution costs.** Settled by the project owner on 2026-09-06. Every option
that resolves a blocker by paying is off the table: a paid Gemini realtime tier,
a paid Twilio number, a Brazilian regulatory bundle. This is the constraint that
turns two open "price it and decide" tasks into a decision already made, and it
means a blocked account is a result to be written down rather than a purchase
order.

**The Gemini free-tier realtime allowance is exhausted, and its shape is
unknown.** Measured across 2026-09-05: early sessions were perfect, a lone probe
held at 35 s, a thirteen-probe pass four seconds apart held four, the same pass
thirty seconds apart held zero, and the independent spike script — code that had
worked that morning — then returned no audio, no transcription and no tool call,
closing cleanly with 1000. Roughly forty sessions had been opened. Nobody has
measured whether it resets daily, and the first task here is to find out for the
price of one session.

**The Twilio trial: 75 free voice minutes over 30 days, a US number, verified
caller IDs only.** One call has been placed. Twilio dialled and rang for 55 s;
the handset never rang; the call ended `no-answer` with duration 0 and no charge.
Everything on our side of that call worked, which is the good news and also the
reason the remaining unknowns are all on the far side of the carrier.

## Goals / Non-Goals

**Goals:**

- Settle the twelve claims a connected call would settle, or record precisely
  which of them remain unsettled and why.
- Spend the scarce budgets in an order where a failure teaches something before
  it costs anything.
- Turn the intermittency of section 7b from three inferred suspicions into an
  event order that can be read.
- Leave the repository honest: `README.md` and the decision log say what the free
  tiers permitted, including if the answer is "not a telephone call".

**Non-Goals:**

- Any paid tier, a Brazilian number, or a regulatory bundle.
- Changing the voice path's behaviour. This change observes it. A bug found here
  is fixed here, but no requirement is rewritten in advance of evidence.
- Certifying latency. A free-tier turn takes tens of seconds; that is the tier.
- Re-proving extraction and scoring, which a simulated call already proved end to
  end on a real attempt row.

## Decisions

### D1 — Diagnose the allowance before spending anything on the acoustics

The three suspicions in section 7b are not equally likely and they are not
equally cheap to test. Free-tier exhaustion is now the leading explanation and it
is also the one that invalidates every other measurement taken after it set in —
the eval's 4-second pass held four probes, the 30-second pass held zero, and the
spike script that had worked that morning returned nothing. If the allowance
resets, every reading from late on 2026-09-05 is void and the headphone question
has never actually been asked.

So the first task is one session of the independent spike script, alone, after a
suspected reset. It costs one session and it either revalidates or voids five
other tasks. Only if it produces audio does the headphone test become meaningful.

The alternative — testing headphones first, because it is free of quota reasoning
— was rejected: a silent session proves nothing about echo, and it would consume
the very allowance the diagnosis needs.

### D2 — The event log is instrumentation, not telemetry, and it never carries speech

The log records provider events: their type, their timestamp, and enough shape to
order them. It records that an `audio` event arrived and how many bytes it
carried; it does not record the bytes. It records that a transcription event
arrived; it does not record the words.

This is not squeamishness. Spec section 10 says call audio is never stored, and a
debug log that quietly accumulates lead speech in a server log is that rule broken
through a side door. The transcript already has a home — the attempt row, with a
twelve-month expiry — and the event log's job is orthogonal: it answers "in what
order did `interrupted`, `turn_complete` and `audio` arrive around the stall",
which needs no content at all.

Off by default, behind one environment flag, so that enabling it is a deliberate
act on a machine someone is watching.

### D3 — The proof run is twelve separate claims, not one pass/fail

`voice-bridge` task 13.2 was one checkbox covering dispatch, TwiML, media stream,
conversation, status callback, outcome, transcript, extraction, score, narrative,
judge and portal. That is the right thing to *do* in one call and the wrong thing
to *record* as one result: a call that connects, converses and then loses its
status callback has proven eight things and failed one, and a single checkbox
reports it as failure.

So the run is one call, and the record is twelve claims settled individually.
This matters more here than anywhere else in the project, because a second call
costs real minutes out of 75 and the first one has to yield everything it can.

### D4 — A blocked account is a deliverable, not a stall

If the caller ID cannot be verified because the Brazilian carrier filters the US
trial number, there is no code that fixes it and, under the no-cost constraint,
no purchase that routes around it. The change then ends by writing down what the
free tiers permit and moving the demo's evidence to the browser harness and
simulated calls, both of which already work and neither of which is a mock: the
harness holds a real Gemini Live conversation, and a simulated call writes a
genuine attempt that is genuinely scored.

The failure mode this decision exists to prevent is the change staying open for
weeks waiting for an external account, exactly as `voice-bridge` nearly did.

### D5 — The stop condition, and where it points

If the Gemini realtime allowance does not reset, or resets too small to sustain
one call, then no telephony task in this change is runnable regardless of what
Twilio does, and the run is not attempted. Twilio minutes are not spent
discovering something the free-tier diagnosis already knows.

This is the same shape as `voice-bridge` task 1.3: one task whose failure
invalidates the plan, stated in advance so it is recognised rather than argued
with.

## Risks / Trade-offs

- **The allowance may never reset in a usable shape.** Then the product's
  headline feature is demonstrable only on a microphone. Mitigated by the harness
  being a real session rather than a simulation, and by saying so plainly rather
  than implying a telephone.
- **The carrier may filter the trial number regardless of verification.** No
  mitigation exists under the no-cost constraint. D4 is the response.
- **One call may not be enough to settle twelve claims.** The budget allows more;
  the risk is that each additional call is spent debugging rather than proving.
  Mitigated by D2: with the event log on, a failed call yields an event order
  instead of a shrug.
- **The event log could become a second transcript by accretion.** Mitigated by
  D2's rule being a requirement with a scenario, not a comment.

## Migration Plan

No schema migration. No new dependency. One environment flag added to
`apps/web/.env.example`, defaulting to off, and nothing in the deployed
configuration changes unless someone is actively debugging.

## Open Questions

- **Does the Gemini free-tier realtime allowance reset, and on what period?**
  Task 1.1 answers it for the price of one session. Everything else in the change
  is conditional on the answer.
- **Is the Brazilian carrier filtering the US trial number?** Task 2.2 answers
  it, and D4 says what happens if the answer is yes.
- **Settled here by the owner's no-cost constraint:** whether to upgrade to a
  paid realtime tier (`voice-bridge` 7b.5) and whether to buy a number
  (`voice-bridge` 3.3). Both are no. The decision log records the constraint
  rather than a price.
