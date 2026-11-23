## ADDED Requirements

### Requirement: The bot owner can enable group achievements

The bot SHALL let the authenticated bot owner enable achievements for a connected group from Bot installations. Activation SHALL require a same-origin POST and an owner Telegram session. It SHALL verify a legacy installation if its recorded bot membership is unavailable.

#### Scenario: The owner activates a connected group from the dashboard

- **WHEN** the configured or paired owner clicks Enable next to a connected group
- **THEN** the bot enables only that group's achievements and displays the persisted status, regardless of the owner's role in the group.

#### Scenario: A request is rejected without changing settings

- **WHEN** the request lacks an owner session, originates from another origin, or targets a private chat, channel, unknown group or disconnected installation
- **THEN** the bot makes no group setting changes.

#### Scenario: Activation preserves the chat dashboard's access policy

- **WHEN** the bot owner activates achievements for a group with restricted dashboard access
- **THEN** activation succeeds. Access to statistics and personal albums still requires Telegram-confirmed membership and a confirmed administrator role where the chat's policy requires it.

#### Scenario: The bot has left a legacy installation

- **WHEN** an old installation has no saved membership record and Telegram confirms the bot is no longer a member
- **THEN** activation returns HTTP 409 and makes no changes.

#### Scenario: Telegram membership verification is unavailable

- **WHEN** Telegram fails to verify the bot's membership for an old installation
- **THEN** activation returns HTTP 503 and makes no changes.

#### Scenario: The bot cannot collect activity statistics

- **WHEN** activity tracking is disabled or the bot has no configured message storage mode
- **THEN** activation returns HTTP 409 and makes no changes.
