## ADDED Requirements

### Requirement: Preserve the registration when restoring callback delivery

The owner setup page SHALL distinguish an explicitly excluded callback update from a working or unverified configuration. The repair action SHALL add only `callback_query` to a verified existing filter on a supported registration. It SHALL retain the endpoint, its matching authentication secret, other requested updates and queued updates. Diagnostics SHALL omit credentials, the webhook URL and raw Telegram errors.

#### Scenario: The owner repairs a legacy registration

- **WHEN** the current registration explicitly excludes callbacks and points to the bot's trusted webhook
- **THEN** the Worker extends the filter and the next status check can confirm callback delivery.

#### Scenario: No change or unsafe change

- **WHEN** callbacks are already available, the destination is unrecognized or the registration requires a custom certificate
- **THEN** no replacement registration is submitted.

### Requirement: Visible button actions in Telegram

The bot SHALL acknowledge a card tap, verify access, and send the card in the originating chat and forum topic. If the image is unavailable it SHALL provide the badge details as text. A tap on a copied group button outside its source group SHALL explain how to open the local group's collection.

#### Scenario: A member taps a group badge in a topic

- **WHEN** the webhook receives that button's callback
- **THEN** the member receives feedback and the photo or text is addressed to the originating topic.
