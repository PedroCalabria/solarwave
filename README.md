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
3. In *Connect* copy the **Transaction pooler** string (port 6543) into
   `DATABASE_URL` and the **Direct connection** string (port 5432) into
   `DATABASE_URL_UNPOOLED`.
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

## Routes

| Route | Screen |
| --- | --- |
| `/pt`, `/en` | Landing page |
| `/pt/confirmacao?lead=<id>` | Post-submit confirmation (reads the created lead) |
| `/portal/login` | Employee sign-in (Supabase Auth) |
| `/portal/leads?status=&q=` | Leads dashboard |
| `/portal/leads/[id]` | Lead detail: score, criteria-driven answers, attempts, transcript |
| `/portal/criteria` | Qualification criteria and scoring settings (admin edits, agents read) |
| `/portal/audit` | Criteria and settings audit history |
| `POST /api/leads` | Intake API |

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` / `pnpm build` | Next.js app |
| `pnpm typecheck` / `pnpm lint` | Every workspace |
| `pnpm test` | Unit tests in every workspace (web and db integration tests run when `DATABASE_URL` is set) |
| `pnpm --filter @solarwave/db test:integration` | Database tests through `.env.local` |
| `pnpm db:generate` | New Drizzle migration from `packages/db/src/schema.ts` |
| `pnpm db:migrate` / `pnpm db:seed` | Apply migrations / load demo data (idempotent) |

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

Not built yet, in order: scoring worker (LLM extraction, reason and icebreaker,
guardrail judge), conversation agent and its text evals, Twilio + Gemini Live
voice bridge, and the lifecycle workflow that actually places and retries calls.
Intake records `next_call_at`, but no call is dispatched.
