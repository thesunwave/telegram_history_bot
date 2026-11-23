## ADDED Requirements

### Requirement: Chat achievement collections in the dashboard

The dashboard SHALL offer an Achievements tab for the selected Telegram group in Russian and English. The tab SHALL show the six group badges, their conditions and recorded awards, and identify disabled weekly collections. Each award SHALL show its qualifying week and result. The view SHALL use the illustrations that ship with the bot on hosted and self-hosted instances.

#### Scenario: Member views a group's collection

- **WHEN** a member with dashboard access opens Achievements
- **THEN** the dashboard shows earned and locked group badges for the selected chat independently of the statistics date filter.

#### Scenario: Viewer switches groups while a request is in flight

- **WHEN** the response for the previous group arrives after the viewer switches groups
- **THEN** only the selected group's achievements can appear.

### Requirement: Personal album is scoped to its owner

The Worker SHALL authorize the selected chat under the existing dashboard access policy and select the personal album using the verified Telegram session. Reading the tab SHALL preserve enrollment, consent, progress and awards.

#### Scenario: Member has a personal album

- **WHEN** the member opens the tab in a chat where they have enrolled
- **THEN** the dashboard shows their earned badges and available progress for that chat, including visible conversation badges under the existing consent rules.

#### Scenario: Collection is paused or has not started

- **WHEN** the group or personal collection is paused, or the viewer has never enrolled
- **THEN** the dashboard explains the state, preserves any earned awards, and indicates how to manage the collection in Telegram. A member who has never enrolled can browse the available badge conditions before starting an album.

#### Scenario: Viewer cannot access the group dashboard

- **WHEN** the viewer lacks the required session, membership or administrator role for an administrator-only dashboard
- **THEN** the achievements endpoint denies access before reading either collection.
