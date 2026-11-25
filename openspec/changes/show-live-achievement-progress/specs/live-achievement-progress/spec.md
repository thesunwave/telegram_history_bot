## ADDED Requirements

### Requirement: Locked badges show measurable progress

The dashboard and Telegram SHALL show the current value, target, and remaining amount for locked badges in active collections. The dashboard response SHALL retain the existing scalar fields. Badges with independent thresholds SHALL show each threshold separately.

#### Scenario: A member checks their collection after new activity

- **WHEN** eligible activity from the current UTC day is available in processed aggregates
- **THEN** both surfaces include it and identify the resulting daily or weekly score as provisional.

#### Scenario: Progress reaches the target before the award job runs

- **WHEN** the score reaches all thresholds and the badge has no recorded award
- **THEN** the badge remains locked and the interface explains that it is awaiting confirmation.

#### Scenario: Statistics are delayed

- **WHEN** current statistics cannot be verified
- **THEN** the interface shows the last available confirmed score and its date or a waiting state if no score is known.
- **AND** an unknown hourly record does not produce a numeric target for Rush Hour.

#### Scenario: An older day could not be verified

- **WHEN** today's personal statistics are verified but an older day has unverified evidence
- **THEN** the provisional personal score includes today's activity and excludes the unverified evidence.

#### Scenario: The week is still in progress

- **WHEN** a member views progress during an eligible UTC week
- **THEN** group progress is scoped to that week, and The Regular reports completed weeks separately from activity during the open week.

### Requirement: Progress refresh preserves access and award rules

Reading progress SHALL cause no changes to awards, enrollments, consent, or reports. Personal counters SHALL be scoped to the enrolled owner and conversation counters SHALL require active consent. Secret badges SHALL be omitted until earned.

#### Scenario: A viewer refreshes the collection

- **WHEN** the dashboard Achievements tab is visible or a member presses Refresh in the Telegram album
- **THEN** the dashboard checks progress each minute and Telegram fetches a fresh score on demand.
- **AND** a dashboard response from a previous chat cannot replace the selected collection.

#### Scenario: The album or conversation collection is paused

- **WHEN** the relevant collection is paused or consent is revoked
- **THEN** the affected live counters are absent and previously recorded awards remain visible to the owner.
