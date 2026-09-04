# @solarwave/core

Pure domain rules for SolarWave. This package performs **no I/O**: no database,
no network, no LLM, no clock reads. Every function is a deterministic function
of its arguments, which is what makes the scoring reproducible and the retry
policy testable without a phone line.

| Module | What it decides | Spec |
| --- | --- | --- |
| `phone` | E.164 normalisation, DDD extraction, Brazil-only rejection | §3.4, §4.2 |
| `timezone` | DDD → IANA zone | §4.2 |
| `window` | 08:00–22:00 local window, push to next opening | §4.2 |
| `retry` | 15 min / 2 days retry schedule, optional requested time | §4.5 |
| `lifecycle` | lead status transition table, outcome enum | §7 |
| `scoring` | `expected_value` grammar, weights, blocking, threshold, enough-information rule | §4.5, §4.6 |

## How later changes should call it

- **Intake** calls `normalizePhone`, `dddToTimezone`, `nextAllowedTime`.
- **Lifecycle workflow** calls `scheduleRetry` and `transition`; persistence
  applies the returned status under a row lock.
- **Scoring worker** turns LLM extraction into `ScoringAnswer[]` and calls
  `scoreLead`; the LLM never produces the score.
- **Portal** calls `parseExpectedValue` to validate criteria on save.

Functions return a `Result` instead of throwing for expected failures. Run
`pnpm --filter @solarwave/core test`.
