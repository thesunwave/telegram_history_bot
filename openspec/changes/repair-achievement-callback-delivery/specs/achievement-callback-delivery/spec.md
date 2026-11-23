## ADDED Requirements

### Requirement: Preserve the registration when restoring callback delivery

The repair action SHALL require owner authentication and reject cross-origin requests. For a verified registration, it SHALL add only `callback_query`, retaining the endpoint, matching secret, connection count, other update types and queued updates. Diagnostics SHALL omit credentials, the webhook URL and raw Telegram errors.

#### Scenario: The owner repairs a legacy registration

- **WHEN** a nonempty `allowed_updates` list omits `callback_query`, the complete webhook URL matches a supported receiver on a trusted origin, its secret is known, and it uses no custom certificate
- **THEN** the Worker extends the filter and the next status check can confirm callback delivery.

#### Scenario: Telegram reports a current IP address

- **WHEN** Telegram reports its current delivery address without specifying whether it is pinned
- **THEN** the owner must confirm DNS-based delivery before repair. Manually pinned addresses require the original registration options.

#### Scenario: No change or unsafe change

- **WHEN** the update list includes callbacks, is empty or absent (Telegram defaults), the destination is unrecognized, or the registration requires a custom certificate
- **THEN** no replacement registration is submitted.

#### Scenario: Caller lacks owner authorization or submits from another origin

- **WHEN** the repair request has no verified owner session or comes from a different origin
- **THEN** the Worker rejects it without calling Telegram to change webhook settings.

### Requirement: Visible button actions in Telegram

The bot SHALL acknowledge a card tap, verify access, and send the card in the originating chat and forum topic. If the image is unavailable it SHALL provide the badge details as text. A tap on a copied group button outside its source group SHALL explain how to open the local group's collection.

#### Scenario: A member taps a group badge in a topic

- **WHEN** the webhook receives that button's callback
- **THEN** the member receives feedback and the photo or text is addressed to the originating topic.
