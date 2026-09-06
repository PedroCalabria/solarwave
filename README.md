# SolarWave

Lead qualification platform for a residential solar company. A bilingual
(PT/EN) landing page captures leads; an AI voice agent calls and qualifies
them; employees review the results in an internal console.

The functional spec is [`solar-lead-qualification-spec.md`](./solar-lead-qualification-spec.md).
Architecture, LLM and data decisions live in [`openspec/config.yaml`](./openspec/config.yaml);
work is planned and tracked as OpenSpec changes under [`openspec/changes/`](./openspec/changes/).
The UI is an implementation of the Claude Design project
*Plataforma de qualificação de leads solar* (`Soltera Lead Platform.dc.html`).

## Layout

```
apps/
  web/            Next.js 16 — landing, confirmation, employee console, intake API  → Vercel
packages/
  core/           Pure domain rules: phone, timezone, call window, retry, lifecycle, scoring (no I/O)
  db/             Drizzle schema, migrations, seed and query functions for Postgres (Supabase)
  ai/             Thin, mockable adapters over the AI SDK: structured output and conversation turns
  scoring/        The scoring worker: extraction, narrative, guardrail judge, recomputation
  agent/          The conversation agent: call script, tools, loop, question linter, persona eval
  voice/          The realtime call: Gemini Live session, audio conversion, Twilio dispatch and the voice eval
openspec/         Decision log (config.yaml) and change proposals, designs, specs and tasks
```

Everything runs on Vercel: the scheduler will be a Vercel Workflow and the
voice bridge a WebSocket route, per the decision log. No separate always-on
service.

## Running it locally

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # fill in Supabase + Turnstile values

# A throwaway Postgres for development and tests (or point DATABASE_URL at Supabase):
docker run -d --name solarwave-pg -e POSTGRES_PASSWORD=solarwave -e POSTGRES_DB=solarwave_test \
  -p 54329:5432 postgres:16-alpine

pnpm db:migrate      # applies packages/db/drizzle/*.sql
pnpm db:seed         # demo leads, criteria, audit history, employees
pnpm dev             # http://localhost:3000
```

### Environment files

Only Next.js loads `apps/web/.env.local` on its own. The `db:*` scripts and
the integration tests go through `dotenv-cli`, which is why their `package.json`
scripts start with `dotenv -e ../../apps/web/.env.local --`. Running a script
by hand works the same way:

```bash
pnpm --filter @solarwave/db exec dotenv -e ../../apps/web/.env.local -- tsx src/seed/index.ts
```

Accepted variable names are documented in [`apps/web/.env.example`](./apps/web/.env.example).
The Vercel Marketplace Supabase integration injects `POSTGRES_URL` /
`POSTGRES_URL_NON_POOLING`; hand-written files may use `DATABASE_URL` /
`DATABASE_URL_UNPOOLED`. Both are accepted.

### Supabase

Supabase is not in the Vercel Marketplace CLI catalog, so provision it directly:

1. Create a free project at <https://supabase.com/dashboard> (region São Paulo).
2. In *Project Settings → API* copy the project URL, the anon (or publishable)
   key and the service-role key.
3. In *Connect* copy the **Session pooler** string (port 5432) into
   `DATABASE_URL` and the **Direct connection** string into
   `DATABASE_URL_UNPOOLED`. Do not use the transaction pooler (port 6543): the
   driver pipelines the concurrent queries each page fires, which that mode
   cannot route, and requests hang until the statement timeout fires.
4. Put them in `apps/web/.env.local`, then:

```bash
pnpm db:migrate && pnpm db:seed
```

For deploys, add the same variables to the Vercel project (`vercel env add`
or the dashboard).

The seed creates two Supabase Auth users (`lucas.prado@soltera.com` as admin,
`aline.ribeiro@soltera.com` as agent) with the password in
`SEED_EMPLOYEE_PASSWORD` (default `solarwave-demo-2026`). Without the Supabase
variables the seed still runs against plain Postgres, but nobody can sign in.

Supabase free-tier projects pause after a week without traffic. Until the
keep-alive cron lands (lifecycle change), restore a paused project from the
Supabase dashboard (*Project → Restore*) before a demo.

### The voice bridge locally

The media bridge needs a WebSocket upgrade, and Next does not perform one. Only
`vercel dev` and a real deployment do — measured, all three with the same
client:

| Command | Upgrade | Use it for |
| --- | --- | --- |
| `pnpm dev` (`next dev`) | no, the socket hangs up | everything except `/api/media` |
| `pnpm dev:voice` (`vercel dev`) | yes, HTTP 101 | anything touching the bridge |
| a deployment | yes, HTTP 101, ~305 s | Twilio, which cannot reach localhost |

Careful when checking this yourself: `vercel dev` spawns its own `next dev`
child on a random port, and that child *does* serve the upgrade because Vercel's
runtime sits in front of it. Probing that port measures `vercel dev`.

Twilio needs a public URL, so the bridge runs behind a tunnel:

```bash
pnpm dev:voice        # vercel dev on port 3999
pnpm tunnel           # ngrok, and writes VOICE_PUBLIC_BASE_URL into .env.local
```

`VOICE_PUBLIC_BASE_URL` is the only thing that follows the tunnel: dispatch
builds the Twilio instruction, status callback and media stream URLs from it on
every call, so there is no webhook to keep in sync in the Twilio console. The
free ngrok plan on this account cannot pin a static domain — `--url` with any
subdomain is refused as a paid "custom subdomain", on `.ngrok-free.dev`,
`.ngrok-free.app` and `.ngrok.io` alike — which is why `pnpm tunnel` writes the
variable rather than telling you to.

For a deployed run, point it at the production domain instead:

```
VOICE_PUBLIC_BASE_URL=https://solarwave-eta.vercel.app
```

That domain is public. The generated deployment URLs and the preview aliases are
behind Vercel Authentication and answer a 302 to SSO, which Twilio cannot
satisfy, so **Twilio only ever talks to production**. The webhooks carry their
own locks — a Twilio signature on each one, and a short-lived signed token bound
to the call SID on the media socket — because on production those endpoints are
publicly reachable and nothing else stands in front of them.

## Routes

| Route | Screen |
| --- | --- |
| `/pt`, `/en` | Landing page |
| `/pt/confirmacao?lead=<id>` | Post-submit confirmation (reads the created lead) |
| `/portal/login` | Employee sign-in (Supabase Auth) |
| `/portal/leads?status=&q=` | Leads dashboard |
| `/portal/leads/[id]` | Lead detail: score, criteria-driven answers, attempts, transcript |
| `/portal/criteria` | Qualification criteria, call order preview and scoring settings (admin edits, agents read) |
| `/portal/audit` | Criteria and settings audit history |
| `/portal/harness` | Voice harness: the realtime agent on your microphone (admin only) |
| `POST /api/leads` | Intake API |
| `POST /api/internal/call` | Places a real call (shared secret) |
| `POST /api/twilio/voice` | Call instructions: connects the media stream |
| `POST /api/twilio/status` | Status callback: closes the attempt and hands it to scoring |
| `GET /api/media` | Twilio Media Streams ↔ Gemini Live (WebSocket) |

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` / `pnpm build` | Next.js app |
| `pnpm dev:voice` | `vercel dev` on port 3999 — the only local server that performs the WebSocket upgrade |
| `pnpm tunnel` | ngrok to port 3999, writing `VOICE_PUBLIC_BASE_URL` into `apps/web/.env.local` |
| `pnpm typecheck` / `pnpm lint` | Every workspace |
| `pnpm build` | Next.js production build — the only check that exercises the server/client module boundary |
| `pnpm test` | Unit tests in every workspace (web and db integration tests run when `DATABASE_URL` is set) |
| `pnpm --filter @solarwave/db test:integration` | Database tests through `.env.local` |
| `pnpm db:generate` | New Drizzle migration from `packages/db/src/schema.ts` |
| `pnpm db:migrate` / `pnpm db:seed` | Apply migrations / load demo data (idempotent) |
| `pnpm eval` | Extraction and guardrail-judge eval against the real model (not in CI) |
| `pnpm eval:agent` | Conversation agent eval: guardrail probes and persona flows (not in CI) |
| `pnpm eval:voice` | The same guardrail probes against the realtime voice model, one session each (not in CI) |
| `pnpm --filter @solarwave/voice spike:live` | One bare Gemini Live session, sharing no code with the bridge. Run it FIRST when voice misbehaves: it separates a broken bridge from an account that cannot serve a session |

## State of the build

Done in the `persistent-foundations` change:

- **Database.** Postgres schema for spec §8, extended with blocking criteria,
  bilingual questions, typed expected values, persisted hand-off threshold,
  answer confidence and evidence, guardrail violations and a DB-backed intake
  rate limit. Seeded with the demo leads and transcripts.
- **Deterministic core.** Phone normalisation (Brazil only), DDD → timezone,
  08:00–22:00 window, 15 min / 2 day retry schedule, lead state machine and the
  scoring engine, all unit-tested without any external service.
- **Intake API** writes to the database with atomic phone dedup, Cloudflare
  Turnstile verification, per-IP rate limiting and first-attempt scheduling.
  Opted-out phones are never re-scheduled.
- **Portal** reads and writes the database behind Supabase Auth with
  `agent`/`admin` roles. Every criteria and settings change is audited.

Done in the `scoring-worker` change:

- **Scoring worker.** LLM extraction under a criteria-derived schema, the
  deterministic engine, reason and icebreaker, a guardrail judge writing
  `guardrail_violations`, and manual recomputation from the portal.

Done in the `conversation-agent-text` change:

- **The call script is assembled from the active criteria.** A fixed frame
  carries the AI disclosure, the tone rules and every spec section 6 guardrail;
  the criteria fill only the middle, in the lead's language, ordered
  blocking-first. Deactivating a criterion shortens the next call with no code
  change.
- **A provider-neutral tool contract** — `record_answer`, `request_callback`,
  `mark_opt_out`, `flag_minor`, `end_call` — projected to both the AI SDK and
  Gemini Live function declarations, so the voice bridge changes the transport
  and not the contract.
- **Question linter**: advisory warnings about tone and guardrail conflicts when
  an admin saves a criterion. It never blocks or delays a save and returns no
  warnings on any model failure.
- **Persona evaluation** (`pnpm eval:agent`): thirteen single-turn guardrail
  probes plus four full flows against scripted personas, budgeted at roughly 39
  model requests. Out of CI, like the scoring eval.
- **Simulated calls**: an admin action on the lead detail runs the real agent
  against a simulated lead, writes a genuine attempt marked `simulated` and
  scores it. Closes conversation → transcript → extraction → score → narrative →
  judge with no telephony.

Built in the `voice-bridge` change, and NOT yet proven on a telephone:

- **A realtime session** (`packages/voice`) driving the same assembled script
  and the same tool contract over Gemini Live: transcript from input and output
  transcription, a 90-second wrap-up, a 3-minute hard stop, and barge-in. The
  provider sits behind a one-function interface, so the timers, the transcript
  and the tool precedence are tested with no network.
- **A browser microphone harness** at `/portal/harness`, admin-only, writing
  nothing — no attempt, no lead change, no score. It exists so the Gemini half
  and the telephony half fail for separable reasons.
- **Audio conversion**: mu-law and a stateful resampler whose lag is constant
  rather than drifting, pure and tested without I/O.
- **Twilio dispatch**, an admin "Call now" action and `POST /api/internal/call`,
  sharing one `dispatchCall` whose refusals — opt-out, in flight, attempt cap,
  unreviewed violation, call window, no criteria, not configured — are enforced
  inside the transaction that reserves the attempt.
- **The webhooks and the media bridge**: TwiML connecting a bidirectional
  stream, the status callback as the authority on how an attempt ended, and
  two-phase attempt persistence keyed by the Twilio call SID. No migration.
- **A voice pass for the guardrail probes** (`pnpm eval:voice`), running them
  against the model that actually speaks rather than the text one.

**No real telephone call has been placed yet.** Two things stand in the way, and
both are written up in `openspec/changes/voice-bridge/tasks.md`:

1. **The realtime session is intermittent** (section 7b). Measured with no audio
   involved at all: sessions opened in quick succession on the Gemini free tier
   die with a 1011 or produce nothing, while the same probe run alone answers
   and holds. It is a free-tier limit rather than the acoustic loop it first
   looked like, and it is unresolved.
2. **Twilio has no usable number on the account** as far as its API reports,
   and no verified caller ID, though the console's own trial panel places calls.

Still not built: the lifecycle workflow that schedules and retries calls
(`leadWorkflow`), the transcript purge and the Supabase keep-alive crons. Intake
records `next_call_at`, but nothing dispatches from it — a call is placed only
by an admin pressing the button.
