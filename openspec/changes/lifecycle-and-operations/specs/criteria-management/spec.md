## ADDED Requirements

### Requirement: Operational settings are persisted and audited like the hand-off threshold
The automatic dispatch flag, the daily call budget and the voice-second budget
SHALL be stored as settings in the same persisted store as the hand-off threshold,
SHALL be mutable only by an administrator, and every change SHALL be audited with
the employee, the previous value and the new value. Enabling automatic dispatch is
the act that lets the system spend a limited external allowance without anyone
present, and it must carry a name and a timestamp.

#### Scenario: Enabling automatic dispatch is audited
- **WHEN** an administrator changes the automatic dispatch setting
- **THEN** an audit entry records who changed it, the previous value and the new
  value, and it appears on the audit page

#### Scenario: An agent cannot change an operational setting
- **WHEN** an employee with the agent role attempts to change a budget
- **THEN** the change is refused and nothing is written

#### Scenario: Budgets are validated before they are stored
- **WHEN** a budget is saved with a negative or non-integer value
- **THEN** the save is refused with a message naming the field

### Requirement: A setting may be a boolean as well as a number
The settings store SHALL accept a boolean value in addition to a numeric one, and
SHALL audit a boolean change in the same shape as a numeric one. The automatic
dispatch flag is a switch, and representing it as zero or one in an administrator's
interface would obscure what it does.

#### Scenario: A boolean setting round-trips
- **WHEN** a boolean setting is saved and read back
- **THEN** it returns as a boolean, not as a number

#### Scenario: A boolean change is audited like any other
- **WHEN** a boolean setting changes
- **THEN** the audit entry records the previous and new values legibly
