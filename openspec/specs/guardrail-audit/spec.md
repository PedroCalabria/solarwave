# guardrail-audit Specification

## Purpose
The post-call audit. A non-realtime model reads the transcript and records violations of the guardrails in spec section 6 that are detectable from text, with a severity fixed per guardrail rather than chosen by the model. Includes the opt-out safety net, which never writes the terminal `opt_out` status from a model finding but blocks further outreach until a human reviews it.
## Requirements
### Requirement: A post-call judge flags the text-detectable guardrails
After a call the system SHALL run a non-realtime model over the transcript and
write one `guardrail_violations` row per finding, with the guardrail key, the
severity and a verbatim `evidence` quote. The judge SHALL cover the seven
guardrails of spec section 6 that are detectable from text: prices or savings,
installation timelines, technical claims, financial advice, competitor
comparison, artificial urgency and unnecessary sensitive data. The four
realtime-only guardrails — AI self-identification, graceful exit on hostility,
detecting that a minor answered, and redirecting out-of-scope questions — are
out of scope here and belong to the conversation agent's evaluation.

#### Scenario: Never provide prices, quotes or savings percentages
- **WHEN** the agent said "você economiza uns quarenta por cento na conta"
- **THEN** a violation with guardrail `no_prices_or_savings` is written quoting that turn

#### Scenario: Never promise installation timelines or crew availability
- **WHEN** the agent said "a equipe instala em duas semanas"
- **THEN** a violation with guardrail `no_timeline_promises` is written

#### Scenario: Never make specific technical claims
- **WHEN** the agent named a panel brand, a system power or a warranty term
- **THEN** a violation with guardrail `no_technical_claims` is written

#### Scenario: Never give financial advice
- **WHEN** the agent suggested financing terms, instalments or a payback period
- **THEN** a violation with guardrail `no_financial_advice` is written

#### Scenario: Never confirm or compare against competitors
- **WHEN** the agent said the company's panels are better than a named competitor's
- **THEN** a violation with guardrail `no_competitor_comparison` is written

#### Scenario: Never use artificial urgency or pressure language
- **WHEN** the agent said the offer ends today or pressed the lead to decide on the call
- **THEN** a violation with guardrail `no_artificial_urgency` is written

#### Scenario: Never collect unnecessary sensitive data
- **WHEN** the agent asked for a full national id number or bank details
- **THEN** a violation with guardrail `no_sensitive_data` is written

#### Scenario: Clean transcript
- **WHEN** the transcript breaks none of the judged guardrails
- **THEN** no violation rows are written for the attempt

### Requirement: Severity is fixed per guardrail, not chosen by the model
The `severity` of a violation SHALL come from a constant table keyed by
guardrail. The model MUST NOT return or influence severity, so the same
violation always ranks the same across runs.

#### Scenario: Same violation ranks the same twice
- **WHEN** the judge is run twice over the same transcript and finds the same guardrail broken
- **THEN** both runs record the identical severity

#### Scenario: Unknown guardrail key is rejected
- **WHEN** the model returns a guardrail key that is not in the table
- **THEN** the finding is discarded and no row is written

### Requirement: An opt-out found in the transcript never writes the opt_out status
Per spec section 6 opt-out takes priority over every other guardrail, and per
the lifecycle it is terminal and irreversible. When the transcript shows
opt-out intent that the live agent did not capture, the worker SHALL write a
`severity = 'high'` violation with guardrail `opt_out_missed`, SHALL clear
`leads.next_call_at`, and MUST NOT set the lead status to `opt_out`.

#### Scenario: Opt-out intent the live agent missed
- **WHEN** the lead said "não me liguem mais" and the attempt has no `opt_out` outcome
- **THEN** a high-severity `opt_out_missed` violation is written, `next_call_at` becomes null and the lead status is unchanged

#### Scenario: Opt-out already captured live
- **WHEN** the attempt outcome is already `opt_out`
- **THEN** the judge writes no `opt_out_missed` violation

#### Scenario: The judge cannot terminate a lead
- **WHEN** the judge reports opt-out intent
- **THEN** no code path writes status `opt_out` from a judge finding

### Requirement: Violations are reviewable and block scheduling until reviewed
`guardrail_violations` SHALL carry `reviewed_at` and `reviewed_by`. An
unreviewed high-severity violation SHALL be a hard stop that prevents any new
call from being scheduled for that lead.

#### Scenario: Employee reviews a violation
- **WHEN** an employee marks a violation reviewed
- **THEN** `reviewed_at` and `reviewed_by` are stamped and the row leaves the unreviewed list

#### Scenario: Unreviewed high-severity violation stops outreach
- **WHEN** a lead has an unreviewed `opt_out_missed` violation
- **THEN** the lead has no `next_call_at` and is reported as blocked pending review

#### Scenario: Medium-severity violation does not block
- **WHEN** the only violation is a medium-severity `no_prices_or_savings`
- **THEN** scheduling is not blocked and the violation is still listed for review

### Requirement: A judge failure does not lose the score
The guardrail judge SHALL run independently of extraction, so that a failure of
the judge cannot discard extracted answers or a computed score.

#### Scenario: Judge fails after a successful scoring
- **WHEN** extraction and scoring succeed but the judge call fails after retries
- **THEN** the score, answers and narrative stay persisted and the attempt is reported as having an unfinished guardrail audit

