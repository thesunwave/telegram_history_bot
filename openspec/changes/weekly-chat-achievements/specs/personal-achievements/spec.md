# Личный альбом

## Purpose

Дать участнику личную коллекцию за разные способы участия и возможность поделиться отдельной наградой, сохранив приватность группы.

## ADDED Requirements

### Requirement: Вход в свой альбом
The bot SHALL open a private album per Telegram account and group. «Мои бейджи» in a group SHALL lead to the bot's private chat. The bot SHALL begin participation automatically when it receives a member's activity in an enabled group. A verified member can view the album before participation begins. Viewing or previewing a badge SHALL only read the album.

#### Scenario: First visit
- **WHEN** a member enters via the group button or opens the bot privately and chooses an eligible group
- **THEN** they see their collection, any results already recorded, and when daily activity starts counting if the bot has yet to record their participation
- **AND** `/achievements` in the group explains automatic participation and the UTC schedule

#### Scenario: Forwarded link or failed membership check
- **WHEN** a user supplies a foreign user ID, opens a copied link or membership cannot be verified
- **THEN** the bot derives the owner from the Telegram sender and displays results only for that owner after a successful membership check

### Requirement: Periods and evidence
The bot SHALL evaluate a participant after each closed UTC date. Daily rules count verified dates from the first UTC midnight on or after the bot receives the activity that starts or resumes participation. A qualifying personal award unlocks once per group and owner. Day-based windows end on the evaluation date and include it. A known qualifying event can count once even when its delivery is retried.

#### Scenario: Early unlock and incomplete history
- **WHEN** three verified qualifying dates occur during the first five days of a 28-day window
- **THEN** a three-date badge can unlock immediately after the third date closes
- **AND** missing evidence never fills a required date, bucket, source or week

#### Scenario: Two groups and concurrent jobs
- **WHEN** the same person earns a badge in group A and partly progresses in group B while two jobs evaluate A
- **THEN** A records one dated unlock with its numeric result and B retains its own progress

### Requirement: Ритм участия
The album SHALL offer three badges for returning to the chat. An active date requires at least one counted participant message in that group.

#### Scenario: До завтра
- **WHEN** the owner is active on two consecutive UTC dates
- **THEN** unlock «До завтра» with the two dates

#### Scenario: Завсегдатай
- **WHEN** the owner is active at least once in each of four consecutive completed Monday–Sunday UTC weeks entirely within their current participation period
- **THEN** unlock «Завсегдатай» even if the owner posted just once per week

#### Scenario: Весь календарь
- **WHEN** all seven distinct weekdays appear among the owner's active dates within the last 42 days
- **THEN** unlock «Весь календарь», including when the seven weekdays occurred in different weeks

### Requirement: Восстание из ридонли
The bot SHALL unlock «Восстание из ридонли» immediately on the first qualifying message sent at least 30 days after that author's most recent previous message in the same group. A recorded timestamp from before participation can establish the baseline. The first known message establishes the baseline without awarding the badge.

#### Scenario: Announce a return
- **WHEN** the member earns «Восстание из ридонли» and enabled its public announcement before the qualifying message
- **THEN** the bot can reply with the personal card to that message in the group while the member's announcement consent remains active

### Requirement: Время и слово
The album SHALL offer three badges based on text totals and UTC activity buckets. The album SHALL show the UTC boundaries wherever a time-of-day condition appears.

#### Scenario: Колумнист
- **WHEN** the owner accumulates at least 100 counted words on each of three distinct dates within 28 days
- **THEN** unlock «Колумнист» whether the words came from one or several messages on each date

#### Scenario: Ночная смена
- **WHEN** the owner posts during 22:00–04:59 UTC on three distinct UTC dates within 28 days
- **THEN** unlock «Ночная смена» using the date of each message and at most one credit per date

#### Scenario: Три смены
- **WHEN** three distinct UTC dates within 28 days supply three different activity buckets, one chosen per date
- **THEN** unlock «Три смены» using night 22–04, morning 05–11, daytime 12–16 and evening 17–21 inclusive
- **AND** three buckets on one day plus two dates with only the same single bucket cannot satisfy the rule

### Requirement: Личный эфир и находки
The album SHALL offer four badges for media and curation. Voice notes, round video notes and manual incoming channel reposts SHALL use their own counters.

#### Scenario: Радиодневник
- **WHEN** the owner sends at least one voice note on each of three dates within 28 days
- **THEN** unlock «Радиодневник» even if every recording is brief

#### Scenario: Кинохроника
- **WHEN** the owner sends a round video note on three distinct dates within seven days
- **THEN** unlock «Кинохроника» and count each date once

#### Scenario: Двойной эфир
- **WHEN** on two distinct dates within 28 days the owner sends both a voice note and a round video note on each date
- **THEN** unlock «Двойной эфир»

#### Scenario: Киоск прессы
- **WHEN** the owner's manual reposts from identifiable channels span at least three distinct channel IDs and three distinct UTC dates within 28 days
- **THEN** unlock «Киоск прессы» with the two counts, evaluating the source and date thresholds independently
- **AND** automatic forwards, hidden-person sources and copied links contribute nothing

### Requirement: Progress, pause and sharing
The album SHALL show a rule, window and progress for each available badge and the original result and date for each earned one. Only the owner SHALL be able to request a shareable personal card privately. Weekly group posts SHALL contain group achievements only.

#### Scenario: Browse and share
- **WHEN** the owner has voice notes on two qualifying dates and opens «Радиодневник»
- **THEN** the album shows «2 из 3 дней за последние 28» and the missing condition
- **WHEN** the owner later selects «Поделиться» on the earned badge
- **THEN** the bot returns one forwardable photo in private with its badge, date and result, omitting names, handles, group titles, source channels, quotes and private album links

#### Scenario: Pause and erase
- **WHEN** the owner pauses participation or the group disables achievements
- **THEN** new progress stops and earned entries remain available
- **WHEN** the group re-enables achievements
- **THEN** group-paused participants resume from the next eligible midnight and personal pauses stay in effect until the member resumes their collection
- **WHEN** the owner confirms «Удалить мой альбом» for a group in private
- **THEN** participation, progress and earned results for that owner/group are erased without affecting group awards or other albums. The bot starts a new collection when it observes that member's group activity again.
