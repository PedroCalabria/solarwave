## ADDED Requirements

### Requirement: Saving a criterion may return advisory warnings
The criteria form SHALL be able to carry warnings alongside a successful save.
Warnings are advice about a saved criterion, distinct from the field errors that
reject a save. A warning SHALL never change whether a criterion was persisted.

#### Scenario: Saved with a warning
- **WHEN** a criterion is saved and the linter reports a tone concern
- **THEN** the form reports the save succeeded and shows the warning separately from any field error

#### Scenario: Warnings and field errors are distinct
- **WHEN** a save is rejected for an invalid weight
- **THEN** the response carries a field error and no warnings

### Requirement: The criteria view shows the derived call order
Because the script orders questions by `blocking` and `weight` rather than by
`sort_order`, the criteria view SHALL show the order in which the agent will
actually ask the active criteria, so an admin editing `sort_order` is not misled
about the call.

#### Scenario: Call order differs from list order
- **WHEN** a blocking criterion sits last in `sort_order`
- **THEN** the criteria view shows it first in the call order preview while the list keeps its `sort_order` position

#### Scenario: Only active criteria appear in the preview
- **WHEN** a criterion is inactive
- **THEN** it is absent from the call order preview
