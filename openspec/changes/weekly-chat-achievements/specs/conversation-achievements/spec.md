# Достижения за разговор

## Purpose

Поощрять обмен репликами между участниками, включая автора одного сообщения, от которого началось обсуждение.

## ADDED Requirements

### Requirement: Observable replies
The second release SHALL add four private album badges derived from explicit Telegram replies within the same group. Both authors must have joined the conversation feature before their respective messages and still participate at reply time. The bot SHALL use verified human sender identities and message IDs. Self-replies, bots, anonymous senders, quotes from elsewhere and duplicate deliveries SHALL not count.

#### Scenario: Feature activation
- **WHEN** reply observation begins in a group
- **THEN** only eligible messages and replies observed from activation onward contribute, and the private album identifies the start of observation
- **AND** a group still on the first release continues to show ten attainable personal badges

#### Scenario: Missing parent
- **WHEN** a delayed reply arrives before its parent is available
- **THEN** it can count once only after the parent, eligibility and same-group relationship are verified within the observation window

### Requirement: Four forms of conversation
The album SHALL grant each badge once per owner and group. Time limits below use Telegram message timestamps. A direct reply references its immediate parent. A chain follows parent links in chronological order.

#### Scenario: Пинг-понг
- **WHEN** two enrolled people produce a chain A → B → A → B of four messages within 24 hours, each message after the first a direct reply to the preceding one
- **THEN** both earn «Пинг-понг» and four standalone messages from the same pair do not qualify

#### Scenario: Искра
- **WHEN** three distinct eligible people directly reply to the same message within 48 hours of its publication
- **THEN** the original author earns «Искра», even if they only wrote that one message

#### Scenario: Связующее звено
- **WHEN** the owner directly replies to three distinct eligible people and each person directly answers that reply, all six replies within 28 days
- **THEN** the owner earns «Связующее звено» and repeated exchanges with a single person count as one counterpart

#### Scenario: Продолжение следует
- **WHEN** someone directly replies to the owner's message at least 24 hours and at most seven days later and the owner directly answers them within the following 24 hours
- **THEN** both earn «Продолжение следует» for resuming the conversation

### Requirement: Restricted observation
The bot SHALL evaluate this feature only after group activation and individual enrollment. It SHALL store transient reply evidence for at most 28 days, retain aggregate award results and omit text, counterpart identities and message links from album entries and cards.

#### Scenario: Opt-out
- **WHEN** a participant withdraws from reply observation
- **THEN** no new interactions involving them count, their transient reply evidence is removed, and unrelated participants keep their earned badges
