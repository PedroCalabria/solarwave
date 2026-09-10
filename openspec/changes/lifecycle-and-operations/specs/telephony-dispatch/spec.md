## ADDED Requirements

### Requirement: Dispatch enforces the operational envelope alongside its existing refusals
The call-placing function SHALL evaluate the dispatch budget and the automatic
dispatch setting beside the refusals it already applies — opted out, attempt in
flight, attempt cap reached, outside the call window, no active criteria,
unreviewed guardrail violation and not configured — and SHALL return the reason in
the same shape, so every caller and the portal handle it the way they already
handle a refusal.

#### Scenario: A budget refusal looks like every other refusal
- **WHEN** a dispatch is refused because a budget is exhausted
- **THEN** the caller receives a refusal carrying a reason, in the same shape as an
  opt-out or call-window refusal

#### Scenario: The existing refusals still take precedence where they must
- **WHEN** a lead has opted out and a budget is also exhausted
- **THEN** the dispatch is refused and no attempt is created, regardless of which
  reason is reported

#### Scenario: The caller identifies itself
- **WHEN** the call-placing function is invoked
- **THEN** it can tell whether the request originated from the durable run or from
  a person, so the automatic dispatch setting is applied only to the former

### Requirement: A closed attempt carries what the call consumed
When an attempt is closed, the system SHALL record the telephony duration reported
for the call and the realtime duration the conversation held, so that the dispatch
budgets have something to measure and the portal has something to show.

#### Scenario: The provider's reported duration is recorded
- **WHEN** the provider reports a call duration as the attempt closes
- **THEN** that duration is recorded on the attempt

#### Scenario: A conversation that never happened records none
- **WHEN** an attempt closes without a conversation having taken place
- **THEN** no realtime duration is recorded for it
