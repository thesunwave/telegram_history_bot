## ADDED Requirements

### Requirement: Dutch Rudder unlocks for both participants

The bot SHALL award «Голландский штурвал» to both participants in one atomic write. In the same chat and rolling 28-day window, each must directly reply to the other on a different UTC date and draw direct replies from two distinct people outside the pair within 24 hours. The chat must enable the conversation shelf and the two recipients and all outside responders must individually opt in. Windows use Telegram message timestamps.

#### Scenario: Two successful branches with reversed roles

- **WHEN** the two branches meet the threshold on different UTC dates
- **THEN** both personal albums store the badge with «Два раза передали штурвал — и оба раза чат пошёл за вами.»

#### Scenario: Evidence arrives late or is replayed

- **WHEN** a late update verifies the last required reply relationship
- **THEN** both participants can unlock the badge once per chat, and replaying the update creates no duplicate awards.

### Requirement: The secret stays out of a locked collection

The Telegram album and dashboard SHALL reveal the badge only to an album owner who earned it. The poster and unlock text SHALL appear with the earned badge, and each recipient SHALL be able to share their own card. The dashboard SHALL require membership and an earned award before serving the poster.

#### Scenario: An album has no award

- **WHEN** the viewer opens the album or guesses a Telegram preview action
- **THEN** the bot shows no badge, progress or rule for this achievement.
