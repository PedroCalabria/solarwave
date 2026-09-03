# SolarWave

Lead qualification platform for a residential solar company. A bilingual
(PT/EN) landing page captures leads; an AI voice agent calls and qualifies
them; employees review the results in an internal console.

The functional spec is [`solar-lead-qualification-spec.md`](./solar-lead-qualification-spec.md).
The UI is an implementation of the Claude Design project
*Plataforma de qualificação de leads solar* (`Soltera Lead Platform.dc.html`).

## Layout

```
apps/
  web/          Next.js 16 — landing, confirmation, employee console, intake API  → Vercel
packages/       (empty) db / core / prompts land here
```

`apps/voice` — the always-on service that owns the Twilio bridge, the call
scheduler, the scoring worker and the transcript cleanup job — is not built
yet. See the spec, §9.

## Running it

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

| Route | Screen |
| --- | --- |
| `/pt`, `/en` | Landing page |
| `/pt/confirmacao` | Post-submit confirmation |
| `/portal/login` | Employee sign-in |
| `/portal/leads` | Leads dashboard |
| `/portal/leads/[id]` | Lead detail, transcript and call attempts |
| `/portal/criteria` | Qualification criteria |
| `/portal/audit` | Criteria audit history |
| `POST /api/leads` | Intake API |

## State of the build

The screens are complete and match the design. What sits behind them does not
yet:

- **No database.** Leads, criteria and audit entries come from
  `apps/web/src/lib/leads.ts`. Portal mutations live in component state and are
  lost on reload.
- **Intake API is a stub.** `POST /api/leads` does real validation, phone
  normalisation, dedup and per-IP rate limiting, but in process memory — it
  resets on restart and does not span instances. No CAPTCHA. No call is
  scheduled.
- **No auth.** Any non-empty work email reaches the console.
- **Imagery** is in place except the confirmation-screen panel, which is still a
  placeholder. See [`apps/web/public/assets/README.md`](./apps/web/public/assets/README.md).
