## 1. Spikes — settle the three external unknowns before anything is built

Sections 1 to 3 answer questions whose answers change the shape of the change.
Nothing below section 4 should start until they have.

- [x] 1.1 List the models the free Google AI Studio key can reach (`curl -H "x-goog-api-key: $GOOGLE_GENERATIVE_AI_API_KEY" "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200"`) and identify the native-audio Live model. Record the exact id and its stated input/output sample rates in the decision log; do not trust the ids or rates written there today (design D12)
- [x] 1.2 Open a Live session with `@google/genai` from a throwaway script: send a few seconds of PCM, and confirm you get back audio, input transcription, output transcription and one function call from a single declared tool. Record what the free tier actually permits — session length, concurrency, per-minute and per-day caps — and what an exhausted quota looks like on the wire
- [x] 1.3 STOP CONDITION: if native audio is not reachable on the free tier, stop and record the options (paid tier, or a cascade of realtime text plus TTS) rather than building against an assumption. This is the one task whose failure invalidates the design

MEASURED 2026-09-05 (`packages/voice/src/spike/live.ts`, @google/genai 1.52.0).
The stop condition did NOT fire — native audio is reachable on the free key —
but the spike found a trap the design would otherwise have walked into:

- PIN `gemini-2.5-flash-native-audio-preview-09-2025`. Function calling works,
  the session closes 1000, and `record_answer` and `end_call` both fired.
- `preview-12-2025` is BROKEN for tools: correct audio and transcription, then
  a 1011 "Internal error occurred" the instant the model calls a function.
  Reproduced with five tools and with one minimal tool, so the fault is the
  model, not our declarations. `-latest` aliases it and is broken too.
- Output audio is `audio/pcm;rate=24000` mono PCM16, as the design assumed.
- `toFunctionDeclarations()` is accepted unchanged; `$schema` and
  `additionalProperties` need no stripping.
- The model omits required arguments (`record_answer` with no `value`,
  `end_call` with no `reason`), which `loop.ts` already defaults rather than
  guesses. Section 6 must keep that tolerance.
- `sendClientContent` during generation also yields 1011: the wrap-up injection
  in task 6.4 must wait for `turnComplete`.
- Input-audio transcription is still unverified; it needs real speech (task 7).

## 2. Spike — the Vercel WebSocket beta on this project

- [x] 2.1 Confirm Fluid Compute is enabled on the linked project, and add `vercel.json` with `maxDuration: 300` for the media route (design migration plan). The project has no `vercel.json` today
- [x] 2.2 Deploy a trivial `GET /api/ws` echo route using `experimental_upgradeWebSocket` from `@vercel/functions` to a preview, and connect to it. Confirm the upgrade works on Next 16 on Hobby, and measure how long a connection actually survives
- [x] 2.3 Establish the local development loop and write it down in the README: `next dev` does not perform the upgrade, so the loop is `vercel dev` plus a tunnel, or a preview deployment. Whichever it is, the next twelve sections depend on knowing it
- [x] 2.4 STOP CONDITION: if the upgrade does not work, switch to the Fastify-on-Fly.io host for the bridge only and record the decision. Sections 4 to 7 are unaffected either way — that is what design D2 buys

MEASURED 2026-09-05 against a preview deployment of `/api/ws`:

- The upgrade WORKS. HTTP 101 from a Next 16 route handler on Hobby, with
  bidirectional echo and a server-side heartbeat. The stop condition did not
  fire and the Fly.io fallback is not needed.
- The connection survived **305.9 s** and then closed with 1006 and no close
  frame — the 300 s function limit cutting it, as the design assumed. The 180 s
  hard stop has comfortable room, and the wrap-up at 90 s more so.
- `vercel.json` lives at `apps/web/vercel.json`, NOT the repo root: the Vercel
  project's root directory is `apps/web`, so function patterns are relative to
  it (`src/app/api/ws/route.ts`). The design's migration plan had the repo-root
  path and was wrong. A pattern matching no function fails the build, so the
  `/api/media` entry is added in task 10.2 and not before.
- FOUND, and it matters for Twilio: the project has **Deployment Protection**
  on. Every request to a preview gets a 302 to `vercel.com/sso-api`, the
  WebSocket upgrade included. Twilio cannot present an SSO cookie or an OIDC
  token, so before task 10 the deployment Twilio talks to needs protection
  disabled or a bypass configured. Testing from here uses the
  `x-vercel-trusted-oidc-idp-token` header via `vercel env run`.

- [x] 2.5 NEW, from the finding above: decide and record how Twilio reaches a
  protected deployment — protection off for the environment Twilio calls, or
  Protection Bypass for Automation with the token in the webhook and stream
  URLs. Blocks task 10, not tasks 4 to 7

SETTLED 2026-09-05, and it needs no setting change. The protection is scoped to
generated URLs, not to the production domain:

| URL | Result |
| --- | --- |
| preview, and the `-pedrocalabriadev` / `-git-main` aliases | 302 to SSO |
| `https://solarwave-eta.vercel.app` (production domain) | 200, and requests reach the app |

So Twilio talks to the production domain, and nothing is disabled. Protection
Bypass for Automation was rejected: Twilio cannot set arbitrary headers on a
webhook, so the secret would travel in the URL — inside the TwiML we generate
and inside Twilio's request logs — to solve a problem that does not exist.

Two consequences:

- **Twilio only ever reaches production.** Previews stay protected and it cannot
  authenticate to them. Local work goes through `vercel dev` plus a tunnel.
- **Task 10's signature verification is the only lock, not a second one.** The
  moment `/api/twilio/status` ships to production it is a public endpoint that
  closes attempts, writes transcripts and triggers scoring. The verification
  goes in the same commit that creates each route — never "wire it up first".

Not yet verified: the WebSocket upgrade on the production domain unauthenticated.
The current production deployment predates `/api/ws`, and promoting a throwaway
echo route to production is exposure with no return. Task 10.2 measures it with
the real route, already signed.

MEASURED for the local loop, all three paths probed with the same client:

| Command | Upgrade | Notes |
| --- | --- | --- |
| `pnpm dev` (`next dev`) | NO — socket hang up, close 1006 | Next does not expose the upgrade |
| `vercel dev` | YES — HTTP 101 | The local loop for anything touching `/api/media` |
| Preview deployment | YES — HTTP 101 | 305.9 s lifetime, then 1006 |

A caution for whoever repeats this: `vercel dev` spawns its own `next dev`
child on a random port, and that child DOES serve the upgrade because Vercel's
runtime is in front of it. Probing that port measures `vercel dev`, not
`next dev`. The row above is from a standalone `next dev` with `vercel dev`
stopped.

## 3. Spike — Twilio reality for a Brazilian demo

- [ ] 3.1 Create the Twilio trial account and establish whether a usable number can be provisioned for this demo: trial numbers are limited to the sign-up country, Brazilian local numbers require a regulatory bundle, and only verified caller IDs can be dialled. Record what is actually possible
- [ ] 3.2 Verify the demo destination number and place one manual test call from the console. Confirm the trial announcement's presence and length, and record how much of the two-minute budget it costs
- [ ] 3.3 DECISION, and the one that may need the project owner: if a real call to the demo number is not possible on the trial, choose between upgrading to a paid number and demonstrating on the browser harness. Record the choice and the remaining call budget in the decision log
- [ ] 3.4 Add the Twilio and voice environment variables to `apps/web/.env.example`, `.env.local` and the Vercel project (design migration plan); add `voice` to `MODEL_ROLES` so `assertConfiguredModels()` covers `AGENT_MODEL_VOICE`, and extend the env unit tests including the `google/`-prefix guard

## 4. Shared call policy out of `loop.ts`

- [x] 4.1 Extract the transport-neutral call state into a new module in `packages/agent`: the live-answer map, the opt-out and minor precedence, the requested-callback capture, and `outcomeFor(reason, enoughInformation)` (design D3). Export it from the barrel; it is pure and client-safe
- [x] 4.2 Rewire `loop.ts` to use it, deleting the private copies. Every existing loop test must pass unchanged — that is the assertion that the extraction changed nothing
- [x] 4.3 Unit-test the extracted module directly: opt-out outranks a stated `end_call` reason, `blocking_failed` maps to `answered_complete` regardless of the answered weight share, and each end reason maps to the outcome the lifecycle expects

## 5. `packages/voice` — audio conversion

- [x] 5.1 Scaffold `packages/voice` (package.json, tsconfig, vitest config) depending on `@solarwave/agent`, `@solarwave/core` and `@google/genai`, registered in the workspace. The barrel stays client-safe; anything touching `@solarwave/db` goes behind a subpath export (repo convention, learned in change 3)
- [x] 5.2 Implement mu-law encode and decode as pure functions over buffers, with the sample rates taken from configuration rather than hard-coded (design D11, D12)
- [x] 5.3 Implement the two resamplers as stateful converters that carry their accumulator across frames, so a long call does not drift
- [x] 5.4 Unit-test the audio path with no I/O: mu-law round trip within tolerance, output sample count correct over one thousand frames, a continuous tone with no discontinuity at frame boundaries, and correct behaviour when the configured output rate differs from the default

Twenty tests, no I/O. Two notes worth keeping, both found by the tests rather
than assumed:

- The resampler trails the input by a bounded number of samples, because an
  output whose second interpolation endpoint has not arrived waits for the next
  frame. The tests assert the lag is CONSTANT between 100 frames and 9000
  (three minutes of 20 ms frames) — a lag that grows is drift, and drift is the
  actual failure mode.
- mu-law has two codes for zero and a quantisation floor: +/-1 comes back as 0
  and +/-4 as +/-8. Both are G.711, not bugs, and both are now pinned by a test
  so a future rewrite cannot quietly change them.

## 6. `packages/voice` — the realtime session

- [x] 6.1 Implement the session: open a Live session configured with `buildCallScript(..., { medium: "voice" })` and `toFunctionDeclarations(keys)`, and expose an interface that takes PCM in and emits PCM out, so both the harness and the bridge drive the same object (design D2)
- [x] 6.2 Accumulate the transcript from input and output transcription into `TranscriptTurn[]`, closing a turn when the speaker changes. Never write audio anywhere (spec section 10)
- [x] 6.3 Handle every tool call through the module from 4.1, and return a result for each one — the lesson change 3 recorded and the decision log repeats: a model that cannot see its own tool calls silently reissues them
- [x] 6.4 Implement the wrap-up injection at `VOICE_WRAP_UP_SECONDS`, the early wrap-up once `hasEnoughInformation` is satisfied, and the hard stop at `VOICE_MAX_CALL_SECONDS`, both configurable and both well inside the platform duration limit
- [x] 6.5 Handle the interruption signal: expose it to the host so it can flush buffered audio, and mark the interrupted transcript turn while keeping its full text (design D8)
- [x] 6.6 Unit-test the session against a fake Live transport: fragments accumulate into turns, the wrap-up fires exactly once, the hard stop resolves `incomplete`, `mark_opt_out` outranks a stated `end_call` reason, `flag_minor` ends the call, and every tool call receives a result

Twenty-nine tests, no network. Sections 11.1 and 11.2 were pulled forward: 6.1
needs `medium: "voice"` to exist, so the frame addendum landed first.

Two things the spike changed in the implementation:

- The wrap-up cannot fire on its timer. Client content pushed while the model
  is generating kills the socket with a 1011, so the timer sets a flag and the
  instruction goes out on the next `turn_complete`. A test drives exactly that
  sequence.
- The agent does not open the call on its own. The voice frame tells it to
  speak first, but a Live session generates nothing until something arrives, so
  the session sends the same `(the lead has answered the phone)` cue the text
  loop uses.

`TranscriptTurn` gained an optional `interrupted` flag rather than a marker in
the text. jsonb, no migration, and the judge still sees every word the model
produced (design D8).

## 7. The browser microphone harness

- [ ] 7.1 Add an admin-only harness page under `/portal` that captures microphone PCM, streams it to the session and plays the audio that comes back
- [ ] 7.2 Show the running transcript, every tool call with its arguments, and the resolved end reason and the outcome it maps to
- [ ] 7.3 Enforce that a harness session writes nothing: no attempt row, no lead transition, no scoring. Assert it in a test, not only by inspection
- [ ] 7.4 Run a full conversation through the harness against the real Live model, in both `pt` and `en`, and record what it cost in quota. This is the first end-to-end proof of the voice half, and it costs no telephony

## 8. Attempt persistence for a real call

- [ ] 8.1 Implement `createDispatchedAttempt` in `packages/db`: inside one transaction, read the lead `FOR UPDATE`, refuse `opted_out`, `attempt_in_flight` and `attempt_cap_reached`, reserve the attempt number, insert the row with `started_at` and `scoring_status = 'pending'`, and apply the `dispatch` transition (design D5, D6)
- [ ] 8.2 Implement `attachCallSid`, `findAttemptByCallSid` and `persistLiveTranscript` (throttled, last write wins on one row)
- [ ] 8.3 Implement `finishAttempt`: idempotent by call SID, sets `ended_at`, `outcome`, `ended_reason` and `transcript_expires_at` at twelve months, and applies the lifecycle transition — never inventing a qualification decision, which only scoring may produce
- [ ] 8.4 Implement `reconcileStaleAttempts(olderThan)`: close attempts open past the hard stop plus a margin as `answered_incomplete` with the retry transition (design D6)
- [ ] 8.5 Integration-test all of it on the PGlite harness: the concurrent-dispatch race yields exactly one attempt, a repeated `finishAttempt` for one SID transitions once, and reconciliation leaves an in-budget attempt alone

## 9. Dispatch

- [ ] 9.1 Implement `dispatchCall` in `packages/voice` behind a server-only subpath: run the preconditions, create the attempt, place the Twilio call with asynchronous machine detection, the instruction URL, the status callback URL and a provider duration limit at least as long as the hard stop, then attach the SID (design D5, D9)
- [ ] 9.2 On a provider error, close the attempt as `failed` and apply the retry transition in the same request, so a Twilio outage costs a retry rather than a lead stuck in `calling`
- [ ] 9.3 Add `POST /api/internal/call` guarded by `CALL_WORKER_SECRET`, rejecting an unauthorised request before reading the body — the shape `POST /api/internal/score` already uses
- [ ] 9.4 Add the admin server action mirroring `simulateCallAction`, and unit-test every refusal reason end to end from the action

## 10. TwiML, the status callback and the media bridge

- [ ] 10.1 Implement `POST /api/twilio/voice`: verify `X-Twilio-Signature`, mint a short-lived token bound to the call SID, and return TwiML connecting a `<Stream>` to the media route carrying that token as a parameter (design D10)
- [ ] 10.2 Implement `GET /api/media`: verify the token and its SID binding before opening anything, then bridge Twilio media frames to the session through the converters from section 5, sending a `clear` on interruption
- [ ] 10.3 Persist the accumulated transcript from the bridge as the call proceeds, throttled, so a bridge that dies does not take the conversation with it (design D4)
- [ ] 10.4 Implement `POST /api/twilio/status`: verify the signature, resolve the outcome from `CallStatus` and `AnsweredBy` through a pure mapping function, close the attempt idempotently, and hand it to `scoreAttempt`
- [ ] 10.5 Unit-test the status mapping with no network: unanswered, busy, failed, each machine-detection value, `unknown` treated as human, and an answered call taking the session's resolved outcome
- [ ] 10.6 Unit-test that an invalid signature on either webhook closes no attempt, writes no transcript and triggers no scoring

## 11. The voice frame and the portal

- [x] 11.1 Add the `medium` input to `buildCallScript`, defaulting to `text`, and write the voice speech section into the existing fixed frame in `frame.ts` — no second prompt builder (design D7)
- [x] 11.2 Unit-test that text assembly is byte-identical to before, that both media carry every section 6 guardrail and the same question list, and that the voice frame orders the AI disclosure before the first question
- [ ] 11.3 Add the real-call action to the lead detail: admin-only, visibly distinct from the simulated action, stating that it dials a real number, with a specific message for each refusal reason and a link to the violations view for `blocked_by_violation`
- [ ] 11.4 Label attempts by kind wherever they are listed, showing the provider call identifier on a real attempt, and show a lead with an attempt in flight as in progress with no second call action

## 12. The voice evaluation pass

- [ ] 12.1 Run the change 3 guardrail probes against the voice model over a Live session, reusing the existing probe definitions and judge, reported separately from the text results
- [ ] 12.2 Report per probe whether the guardrail held, report quota consumed, support running a single probe, and report a rate-limited probe as not run rather than as a guardrail failure
- [ ] 12.3 Keep it out of CI and out of the default `pnpm eval:agent`; decide from the measured cost whether it is a flag on that command or its own script, and record the decision (design open question)
- [ ] 12.4 Run the pass and record the results in the decision log the way change 3 recorded its text measurements — an unmeasured claim about a voice agent is the claim this change exists to stop making

## 13. End to end, and the write-up

- [ ] 13.1 `pnpm build` before believing anything: it is the only check that exercises the server/client module boundary, and `@solarwave/voice` is a new barrel that a Client Component could reach. Delete `apps/web/.next` first if a previous run left a `TurbopackInternalError`
- [ ] 13.2 Place one real call to the verified demo number and confirm the whole chain: dispatch, TwiML, media stream, conversation, status callback, outcome, transcript, extraction, score, narrative, judge, portal
- [ ] 13.3 Place a deliberate opt-out call and confirm the lead reaches terminal `opt_out`, that the attempt outcome is `opt_out`, and that a re-submission of the intake form does not reschedule that phone
- [ ] 13.4 Kill the bridge mid-call on purpose and confirm the status callback still closes the attempt, the transcript survives, and the lead is retryable rather than stuck in `calling`
- [ ] 13.5 Update `README.md` (state of the build, routes, scripts, the local voice development loop) and `openspec/config.yaml` (repository state, the settled open questions, the measured Live model id, sample rates, quotas and the real call budget remaining)
