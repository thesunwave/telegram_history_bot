# Weekly chat achievements

## Purpose

Give a Telegram group a shared collection of milestones and a weekly photo that members can forward to friends.

## ADDED Requirements

### Requirement: Group opt-in
The bot SHALL start weekly reporting disabled for each group and allow a verified administrator of that group to enable or disable it. The first eligible week starts on or after opt-in, on Monday at 00:00 UTC. Disabling stops future reports and awards and preserves the collection.

#### Scenario: Midweek enrollment
- **WHEN** an administrator enables reporting on Wednesday
- **THEN** the bot confirms the dates of the first full Monday–Sunday UTC week and schedules evaluation after that week ends

#### Scenario: Unauthorized request
- **WHEN** a member without administrator privileges attempts to change reporting
- **THEN** the group setting remains unchanged

### Requirement: Weekly group awards
The bot SHALL evaluate six group milestones against verified activity for the closed week, award every newly earned badge once per group, and retain its original week and supporting numbers. An unknown day SHALL be treated as missing evidence.

#### Scenario: Подкастерская
- **WHEN** the group's total voice-note duration reaches 3,600 seconds in the week
- **THEN** it earns «Подкастерская» with its recorded total and count of voice notes
- **AND** 3,599 seconds, or time recorded only in video notes, does not qualify

#### Scenario: Час пик
- **WHEN** one UTC date/hour has at least 30 messages and strictly exceeds every individual hour in the four verified weeks immediately preceding this week
- **THEN** it earns «Час пик» with the winning date/hour, count and previous maximum
- **AND** a tied prior record or incomplete baseline does not qualify

#### Scenario: Без выходных
- **WHEN** at least three distinct authors posted on each of the seven UTC dates
- **THEN** the group earns «Без выходных» even if different authors contributed on different days
- **AND** six qualifying days and one day with two authors do not qualify

#### Scenario: Concurrent or repeated evaluation
- **WHEN** multiple evaluations find two qualifying badges in the same week or a badge qualifies again later
- **THEN** the collection retains one original entry per earned badge

#### Scenario: Круглый стол
- **WHEN** on at least three dates in the week four or more distinct participants posted and the busiest participant supplied at most 40% of counted participant messages on each of those dates
- **THEN** the group earns «Круглый стол» with its number of qualifying days (exactly 40% qualifies)

#### Scenario: Хор
- **WHEN** at least four distinct participants each sent a voice note in the week
- **THEN** the group earns «Хор» with its number of participating voices, even if each recording lasted only a few seconds

#### Scenario: Переходящий кубок
- **WHEN** at least three different people each held the sole highest daily message count on a different date that week with at least three active participants
- **THEN** the group earns «Переходящий кубок» with the number of distinct leaders and no names
- **AND** a date tied for first place contributes no leader

### Requirement: Forwardable weekly photo
The bot SHALL publish a single PNG photo message under its bot identity, with a short caption and collection button. It SHALL show one newly earned badge or one measured fact, the reporting dates, message total and weekly distinct author count. The shared content SHALL contain only group-level statistics and omit chat titles, author identities, message content and dashboard links.

#### Scenario: Several unlocks
- **WHEN** multiple badges unlock together
- **THEN** the card features one badge in the fixed priority order «Час пик», «Переходящий кубок», «Круглый стол», «Подкастерская», «Без выходных», «Хор», and all earned group badges appear in the group collection

#### Scenario: Ordinary active week
- **WHEN** a complete week has messages but no new unlock
- **THEN** the card shows the busiest dated hour in UTC, using the earliest in a tie, and plots hourly counts for that date

#### Scenario: Silent week
- **WHEN** a verified week has zero messages
- **THEN** the bot skips publication

#### Scenario: Incomplete week
- **WHEN** an opted-in week has unverified current-week coverage
- **THEN** evaluation is deferred and no award or publication is produced from partial figures

### Requirement: Scoped collection
The bot SHALL show members of the originating group all six group badges, unlock conditions for locked badges and the week and result of each earned badge. Individual unlocks SHALL remain private to their owners by default. A forwarded card SHALL NOT grant access to the originating group's collection.

#### Scenario: Viewing the collection
- **WHEN** a member opens «Коллекция чата · 2 из 6» in the originating group
- **THEN** they see both earned group results and the conditions for the four remaining group badges

#### Scenario: Button used elsewhere
- **WHEN** the collection action is submitted from another group or a private chat
- **THEN** the bot does not reveal the source group's collection

### Requirement: Delivery replay safety
The bot SHALL prevent concurrent or replayed jobs from sending a second copy of the same report. A delivery with an unknown outcome SHALL not be automatically resent.

#### Scenario: Telegram accepted the photo but the response was lost
- **WHEN** the same chat/week is processed again after an ambiguous send outcome
- **THEN** the awards remain available and the bot suppresses another automatic send
