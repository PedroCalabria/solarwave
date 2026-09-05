## Context

Four changes in, the pipeline runs end to end on everything except a phone. The
seams for this change were cut deliberately in change 3: `buildCallScript`
assembles the system prompt from the active criteria, `TOOL_REGISTRY` already
projects to Gemini Live function declarations, `hasEnoughInformation` and
`transition` are pure and live in `@solarwave/core`, `hasBlockingViolation`
exists in `@solarwave/db`, and `call_attempts` already carries `twilio_call_sid`
behind a unique index. Nothing here needs a migration.

What is missing is everything that only exists once a call is real: placing it,
carrying audio both ways, deciding when it is over, and writing down how it
ended when the process carrying the conversation may not survive to do so.

Three constraints shape every decision below.

**The Hobby plan.** Vercel Functions run on Fluid Compute with a 300-second
maximum duration, and a WebSocket closes when the function reaches it. Our call
budget is 2 minutes target and 3 minutes hard stop, which fits with room to
spare — but only because the hard stop is enforced by us, not discovered by the
platform. There is no instance affinity and no shared memory across connections:
whatever the bridge accumulates lives in one function instance and dies with it.

**The Twilio trial.** Roughly 75 voice minutes over 30 days, about 35 two-minute
calls, only verified caller IDs, and a trial announcement played before the
call connects. That announcement lands ahead of the AI disclosure, which is the
first thing spec section 6 requires the agent to say — the disclosure is still
the agent's first utterance, but the lead hears Twilio first.

**The Gemini free tier.** Native-audio Live is the only free realtime voice API,
its model ids are preview and change, and the free tier caps requests. Change 3
already measured this: `gemini-3.8-flash` is capped at 20 requests per day,
which a single eval run exhausts.

## Goals / Non-Goals

**Goals:**

- A real, guardrail-holding qualification call placed from the portal, whose
  attempt, transcript and score land in the same rows a simulated call writes.
- The Gemini Live half verifiable with zero Twilio minutes.
- One place where "how the call ended" becomes an `AttemptOutcome`, shared by
  the text loop and the voice session.
- An attempt that always reaches a terminal `ended_at`, including when the
  bridge dies mid-call.
- A design whose fallback (Fastify on Fly.io) swaps the host and nothing else.

**Non-Goals:**

- `leadWorkflow`, automatic dispatch, and acting on a requested callback time —
  change 5.
- Storing audio (spec section 10), leaving voicemail, or inbound calls.
- Certifying the voice agent against production traffic. The probes run against
  the voice model; a passing probe run is evidence, not a guarantee.

## Decisions

### D1 — The change is two halves, and the harness half lands first

The voice bridge fails for two unrelated families of reason: the Gemini Live
session (model id, audio format, function calling, transcription, barge-in) and
the telephony path (Twilio auth, TwiML, webhook signatures, Media Streams
framing, answering-machine detection). Built as one block, every bug is
diagnosed against both at once, over a phone, out of a budget of thirty-five
calls.

So the browser-microphone harness is task-ordered first and is a shipped
capability, not scaffolding. It drives the same `packages/voice` session with
PCM straight from the browser, so when Twilio arrives the only new suspect is
the transport.

Alternatives: build Twilio first and treat the harness as optional. Rejected —
it inverts the cost. The decision log's own development strategy already
sequenced it this way ("3. Browser-microphone harness. 4. Twilio last"); this
change honours that sequence instead of collapsing it.

### D2 — A `packages/voice` package, not code in `apps/web`

The realtime session, the audio conversion and the call timers go in a new
workspace package. Three reasons, in order of weight:

1. The documented fallback if the WebSocket beta bites is a small Fastify
   service on Fly.io. If the session lives inside a Next.js route handler, that
   fallback is a rewrite. If it lives in a package, it is a new host importing
   the same function.
2. The audio conversion is pure, deterministic and exactly the kind of code the
   repo's conventions say must be unit-tested without any external service.
3. `@solarwave/agent` exists for precisely this reason — so change 4 would not
   have to import the script and tools from `apps/web`. Putting the voice half
   back in `apps/web` would undo that.

`packages/core` was considered as the home for the audio maths. Rejected: core
is domain rules — phone, timezone, window, retry, lifecycle, scoring — and a
mu-law codec is not a rule about solar leads.

The barrel stays client-safe by construction, the same rule change 3 learned by
breaking the build: anything touching `@solarwave/db` sits behind a subpath
export, never in `index.ts`.

### D3 — The end-of-call policy moves out of `loop.ts` and is shared

`loop.ts` today owns two different things. One is text-shaped: counting turns,
injecting the wrap-up on a turn boundary, calling `respond()`. The other is
policy that has nothing to do with the transport:

- the live-answer map, last write wins per criterion key;
- opt-out outranking every other end reason, including a stated `end_call`;
- minor flagged ends the call;
- `outcomeFor(reason, enoughInformation)`, including the deliberate mapping of
  `blocking_failed` to `answered_complete` so a renter is not called back to
  confirm they still rent.

The second group moves into a transport-neutral module in `@solarwave/agent`,
consumed by `loop.ts` unchanged and by the voice session. `outcomeFor` is
currently module-private, so the voice session would otherwise reimplement it —
and the first time the mapping changed, a text call and a voice call with the
same ending would produce different outcomes and different retries.

This is the same argument D2 of change 3 made for the tool registry, applied to
the other half of the contract. Declaring the tools once and then interpreting
their results twice would have bought half the benefit.

### D4 — The Twilio status callback is the authority on how an attempt ended

The media WebSocket holds the transcript and the tool calls, and it is the least
durable thing in the system: it dies with the function instance, at the 300-second
duration limit, on a redeploy, or on any uncaught error in the bridge. The status
callback is an ordinary HTTP POST from Twilio that fires for every call, including
calls whose media stream never opened.

    place call ──▶ attempt row (twilio_call_sid, started_at, outcome NULL)
                        │
        ┌───────────────┴────────────────┐
        │                                │
    /api/media (WS)                 /api/twilio/status
    best effort                     always fires
    accumulates transcript ────────▶ writes ended_at, outcome, ended_reason,
    and the end reason               transcript, then hands off to scoring

The bridge therefore does not write the attempt's ending. It publishes what it
knows — transcript so far, end reason, live answers, opt-out — and the callback
writes it. If the bridge died before publishing anything, the callback still
closes the attempt: `failed` when the call never connected, `answered_incomplete`
when it did but produced nothing usable. Either is retryable, so a lost bridge
costs a retry, not a stuck lead.

Alternative considered: the bridge writes the ending itself and the callback
only fills gaps. Rejected — it makes the *unreliable* path the primary writer,
and the failure it produces is the worst one available: a lead stuck in `calling`
with `ended_at` null, which `attempt_in_flight` then reads as "a call is already
running" and refuses every future attempt, forever, silently.

Because the bridge and the callback run in different function instances with no
shared memory, "publishes what it knows" means a write. The bridge writes its
accumulated transcript to the attempt row as it goes (throttled, last-write-wins)
rather than only at the end; the callback reads that row. This costs a handful of
UPDATEs per call and removes the entire class of "the bridge had it and took it
with it".

### D5 — Dispatch mirrors the simulated-call action, and refuses in the transaction

`POST /api/internal/call` and an admin "Call now" server action share one
`dispatchCall` function, the way `simulateCallAction` and the future workflow
step share `simulateCall`. Its refusals, in order:

| Refusal | Why |
| --- | --- |
| `opted_out` | Spec section 6: terminal, outranks everything, refused even in a demo |
| `attempt_in_flight` | One attempt per lead at a time |
| `blocked_by_violation` | An unreviewed high-severity guardrail violation blocks dispatch (`lead-lifecycle`, change 2 D8b) |
| `outside_call_window` | 08:00-22:00 in the lead's DDD timezone (spec section 4.2) |
| `attempt_cap_reached` | `MAX_ATTEMPTS` from `@solarwave/core` |
| `no_active_criteria` | Nothing to ask |
| `not_configured` | No Twilio credentials or Live model id |

The first three are checked inside the transaction that reads the lead `FOR
UPDATE` and inserts the attempt, not in the caller, for the same reason
`createSimulatedAttempt` does it there: a check in the caller is a race, and the
race writes a phone call.

The window check is enforced at dispatch rather than only at scheduling. Change 2
made "calls are only *scheduled* within the window" a rule; nothing yet stopped
someone pressing a button at 03:00.

### D6 — Two-phase attempt persistence, keyed by the call SID

`createDispatchedAttempt` writes the row before `calls.create` returns... which
it cannot, since the SID comes from the response. The order is: reserve the
attempt number and insert the row inside the transaction with a null SID, call
Twilio, then update the row with the SID. If `calls.create` throws, the same
request closes the attempt as `failed` and applies the retry transition, so a
Twilio outage costs a retry rather than an in-flight ghost.

`findAttemptByCallSid` is how the status callback and the media stream find the
attempt. `call_attempts.twilio_call_sid` already has a unique index, so a
duplicated callback — Twilio retries — cannot create a second ending;
`finishAttempt` is idempotent and a second call is a no-op.

`reconcileStaleAttempts` closes attempts left open past the hard stop plus a
margin. It exists because D4's guarantee is "the callback always fires", and
"always" over a demo weekend on a free tier deserves a backstop. Change 5 gives
it a cron; this change exposes it as a function and calls it opportunistically
on dispatch.

No migration. Every column this needs already exists.

### D7 — The voice frame is an addendum in `frame.ts`, not a second prompt builder

`buildCallScript` gains a `medium: "text" | "voice"` input, defaulting to
`"text"` so nothing existing changes. The voice medium appends a speech section
to the same frame: no markdown, no enumerated lists read aloud, numbers spoken
as words, short turns, and the AI disclosure spoken as the first utterance
before any question. The guardrails, the criteria assembly, the ordering and the
budget statement are untouched and shared.

Alternative: a separate voice prompt builder in `packages/voice`. Rejected —
spec section 6 guardrails would then live in two files, and the day someone adds
a guardrail they would update one. Change 3's D4 made "the frame is fixed and in
one place" load-bearing; a second builder quietly repeals it.

### D8 — Barge-in keeps the generated text and marks the interruption

On a Gemini `interrupted` signal the bridge sends Twilio a `clear` to flush
buffered audio. What to do with the transcript turn that was cut off is less
obvious: some of it was spoken and some was not, and the API does not say where
the line fell.

The decision is to keep the output transcription in full and mark the turn as
interrupted. The alternative — dropping or truncating it — would hide text the
model actually produced from the guardrail judge. If the agent generated a price
quote and the lead talked over the second half of it, that is still a section 6
violation worth flagging, and a judge that never sees it will never flag it.
The cost is that a transcript may contain words the lead did not fully hear,
which is the safer of the two errors.

### D9 — Answering-machine detection ends the call; it never leaves a message

Twilio dials with `machineDetection` enabled and asynchronous, so the call
connects immediately and the detection result arrives separately. `AnsweredBy`
values `machine_start`, `machine_end_beep`, `machine_end_silence`,
`machine_end_other` and `fax` end the call and resolve the attempt to
`voicemail`; `human` proceeds; `unknown` proceeds, because a human treated as a
machine is worse than the reverse.

`voicemail` is already in the retryable set, so this needs no lifecycle change.
Leaving a message is a non-goal: the spec never asks for one, and a recorded AI
message raises a disclosure question this demo does not need to answer.

### D10 — Webhooks are signature-verified, and the media socket carries a signed token

`/api/twilio/voice` and `/api/twilio/status` validate `X-Twilio-Signature`
against `TWILIO_AUTH_TOKEN`. An unsigned or mis-signed request is rejected
before anything is read — these routes are public, and a forged status callback
could otherwise close an attempt, write a transcript, or trigger scoring.

Twilio does not sign the WebSocket upgrade for Media Streams, so `/api/media`
cannot be verified the same way. Instead the TwiML `<Stream>` carries a
short-lived signed token as a custom parameter, minted when the TwiML is
generated and bound to the call SID. The bridge rejects any stream whose token
is missing, expired, or bound to a different SID.

### D11 — Audio conversion is hand-written, pure and tested

Mu-law encode/decode is a 256-entry table and a well-specified bit layout;
resampling 8 kHz to 16 kHz and 24 kHz to 8 kHz is linear interpolation with an
accumulator to avoid drift across frames. Perhaps 150 lines, no dependency, and
testable the way `packages/core` is tested: round-trip a known waveform, assert
frame boundaries, assert no drift over a thousand frames.

A dependency was considered and rejected on size and on the fact that the bug we
actually fear — a sample-rate mismatch that makes the agent sound like a chipmunk
on a real call — is caught by a unit test either way, and only if we write one.

### D12 — Model ids and audio formats are verified before anything is built

The decision log already says the Live model ids are preview and must be
verified at implementation time. This change makes that task 1 and gives it a
stop condition: list the models the free key can reach, open a Live session,
send audio, and get transcribed audio and one function call back. If native
audio is not reachable on the free tier, the design's core assumption is gone
and the change stops for a decision, rather than discovering it three days in.

The same spike records the actual input and output sample rates rather than
trusting the decision log's 16 kHz / 24 kHz, because D11's resampler is written
against whatever it reports.

### D13 — The webhooks are locked by a token we mint, not only by Twilio's signature

D10 said the webhooks would be verified by `X-Twilio-Signature`. They cannot be,
on their own: Twilio computes that signature with the account AUTH TOKEN, and
this project authenticates with an API key so a deployment credential can be
revoked without locking the account out. There is no API-key variant of the
signature.

Leaving the endpoints unverified was never an option — in production they are
publicly reachable (task 2.5), and they close attempts, write transcripts and
trigger scoring.

So the lock moves to something we control. `dispatchCall` builds the instruction
and status-callback URLs itself, so each carries a token signed with
`CALL_WORKER_SECRET` and bound to the attempt id — the same mechanism the media
socket already needed, for the same reason. Signature validation is layered on
top whenever `TWILIO_AUTH_TOKEN` happens to be configured, because it proves
something the token does not: that the request really came from Twilio.

Alternatives considered: requiring the auth token outright, which trades the
revocability the API key was chosen for; and accepting Twilio's signature alone,
which is not available. The trade-off taken is that the token appears in the URL
and therefore in Twilio's request logs. That is the property of any bearer
credential in a callback URL, it is scoped to one attempt, and it expires in an
hour.

## Risks / Trade-offs

- **The Vercel WebSocket beta may not support this shape at all.** RESOLVED
  2026-09-05 (task 2): an echo route on a preview deployment upgraded to HTTP
  101 from a Next 16 route handler on Hobby and held the connection for 305.9 s
  before the 300 s function limit closed it with a 1006. The Fly.io fallback is
  not needed. D2 keeps it cheap anyway, and the finding that the connection
  really does die at the platform limit is what makes the 180 s hard stop a
  budget rather than a hope.
- **`next dev` does not perform the upgrade.** CONFIRMED by measurement: a
  standalone `next dev` hangs the socket up with no 101, while `vercel dev`
  returns 101. The local loop is therefore `vercel dev` plus a tunnel for
  Twilio's webhooks, which is slower and unfamiliar → the pure halves (audio,
  timers, outcome mapping, preconditions) are unit-tested with no server at
  all, and the harness (D1) runs against `vercel dev` or a preview.
- **Deployment Protection blocks Twilio.** FOUND in task 2: the project has it
  on, so every preview request — the WebSocket upgrade included — gets a 302 to
  Vercel's SSO. Twilio can present neither an SSO cookie nor an OIDC token →
  task 2.5 decides between turning protection off for the environment Twilio
  calls and Protection Bypass for Automation. It blocks task 10 and nothing
  earlier. Testing from a developer machine uses the
  `x-vercel-trusted-oidc-idp-token` header through `vercel env run`.
- **The Twilio trial may not permit a Brazilian number or an outbound call to
  the demo phone.** Trial numbers are limited to the sign-up country, Brazilian
  local numbers require a regulatory bundle, and only verified caller IDs can be
  called → task 3 establishes this before the bridge is written, and the answer
  is a decision (upgrade to paid, or demo on the harness) rather than a
  discovery on demo day. Everything before task 3 is independent of it.
- **Thirty-five calls is the entire budget, and debugging eats calls** → D1
  moves every reproducible bug off the phone, and the plan reserves a fixed
  number of real calls, spent deliberately.
- **The trial announcement plays before the AI disclosure** → the disclosure is
  still the agent's first utterance and the guardrail holds as specified; the
  announcement is Twilio's, not the agent's, and it disappears on a paid number.
  Stated rather than mitigated.
- **A green text eval does not certify the voice model** — change 3 said this
  plainly and it is still true → the probes re-run over a Live session (the
  voice pass), which narrows the gap to prosody and latency rather than closing
  it. A voice probe run is evidence, not certification.
- **The bridge writing transcripts as it goes costs UPDATEs on the free Supabase
  tier** → throttled to at most one write every few seconds per call, last write
  wins, one row. At thirty-five calls this is noise; at production volume it
  would be reconsidered, and this is a demo.
- **A real call mutates real lead rows, exactly as a simulated one does** →
  same mitigations as change 3's D9: admin-only, refused for opt-out, in-flight
  and blocked leads, and `pnpm db:seed` restores. The addition here is that a
  real call also dials a real telephone, which is why the verified-number rule
  is a refusal and not a convention.
- **Two ways to end a call now exist** (the agent calling `end_call`, and the
  hard stop cutting the line) → both funnel through the shared mapping from D3,
  and the hard stop maps to `incomplete`, which is retryable. The failure mode
  is an extra call, never a fabricated qualification.

## Migration Plan

No database migration. No schema change.

**Dependencies** added: `@google/genai` (realtime only), `twilio`,
`@vercel/functions`. Text generation stays on `@ai-sdk/google@3.0.121`; the two
SDKs do not overlap.

**`vercel.json`** is created at `apps/web/vercel.json`, NOT the repo root: the
Vercel project's root directory is `apps/web`, so function patterns are relative
to it. A pattern matching no function fails the build, so the media entry only
appears once that route does:

    {
      "functions": {
        "src/app/api/media/route.ts": { "maxDuration": 300 }
      }
    }

**Environment**, added to `apps/web/.env.example`, `.env.local` and the Vercel
project:

    TWILIO_ACCOUNT_SID=
    TWILIO_AUTH_TOKEN=
    TWILIO_FROM_NUMBER=
    # Public origin Twilio reaches for webhooks and the media socket.
    # A tunnel host locally, the deployment URL in preview and production.
    VOICE_PUBLIC_BASE_URL=
    # Gemini Live native audio. Preview id, verified against the live model
    # list, never hardcoded in source — same rule as every other model role.
    AGENT_MODEL_VOICE=
    VOICE_WRAP_UP_SECONDS=90
    VOICE_MAX_CALL_SECONDS=180
    # Guards POST /api/internal/call, as SCORING_WORKER_SECRET guards scoring.
    CALL_WORKER_SECRET=

`AGENT_MODEL_VOICE` joins `MODEL_ROLES`, so the existing
`assertConfiguredModels()` check covers it — including the guard that rejects a
Gateway-style `google/`-prefixed id.

**Rollback**: every new surface is additive. Removing `TWILIO_ACCOUNT_SID` makes
dispatch refuse with `not_configured` and leaves simulated calls, the portal and
scoring exactly as they are today.

## Open Questions

- **Settled here — how a real attempt ends when the bridge does not survive.**
  The status callback is authoritative (D4), the bridge persists incrementally,
  and `reconcileStaleAttempts` is the backstop. The alternative left leads stuck
  in `calling` forever.
- **Settled here — where the end-reason-to-outcome mapping lives.** One
  transport-neutral module in `@solarwave/agent`, used by both the text loop and
  the voice session (D3).
- **Settled here — what triggers a call before `leadWorkflow` exists.** An
  admin action plus a secret-guarded internal route, sharing one `dispatchCall`
  with all preconditions enforced in the transaction (D5).
- **Still open, and change 5's — the requested callback time.** `request_callback`
  keeps capturing it verbatim and keeps mapping to `answered_incomplete`. There
  is still no column, and `scheduleRetry` already accepts an explicit requested
  time, so change 5 needs a column and a policy decision, not new agent work.
- **Still open, and answered by task 3 — whether the Twilio trial can place this
  call at all.** If it cannot, the decision is upgrade or demo on the harness.
  Recorded here because the answer changes what the demo shows, not how the code
  is written.
- **Still open — whether the voice probe pass belongs in `pnpm eval:agent` or a
  separate script.** It costs real audio minutes on the Gemini free tier, which
  the text suite does not, and mixing them makes a cheap run expensive. Decided
  during task 12, when the actual cost is known rather than guessed.
