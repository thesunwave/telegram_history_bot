## ADDED Requirements

### Requirement: The bot owner can enable group achievements

The bot SHALL let the authenticated bot owner enable achievements for a connected group from Bot installations. Activation SHALL require a same-origin POST and an owner Telegram session. It SHALL verify a legacy installation if its recorded bot membership is unavailable.

#### Scenario: The owner activates a connected group from the dashboard

- **WHEN** the configured or paired owner clicks Enable next to a connected group
- **THEN** the bot enables only that group's achievements and displays the persisted status, regardless of the owner's role in the group.

#### Scenario: A request is rejected without changing settings

- **WHEN** the request lacks an owner session, originates from another origin, or targets a private chat, channel, unknown group or disconnected installation
- **THEN** the bot makes no group setting changes.

#### Scenario: Chat statistics are limited to group administrators

- **WHEN** the bot owner activates achievements for a group with restricted dashboard access
- **THEN** activation succeeds while access to statistics and personal albums continues to follow the existing dashboard policy.
