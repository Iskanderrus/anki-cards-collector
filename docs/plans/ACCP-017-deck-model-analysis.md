# ACCP-017: Deck note-type analysis and representative card preview

## Goal

Help users understand what note types are actually used in a selected deck and show representative existing cards before they configure Collector export.

## Dependencies

- ACCP-016.

## Why

A deck is only a destination. It does not define card layout.

The same deck may contain several note types, while each note type may have several card templates.

Collector therefore needs to show evidence, not infer intent.

## AnkiConnect surface

Use bounded read-only calls:

- `findCards` with a deck-scoped search;
- `cardsInfo` for sampled card IDs;
- optionally `notesInfo`/`cardsToNotes` only when needed for metadata not already returned by `cardsInfo`.

`cardsInfo` is the primary inspection source because it can expose:

- deck name;
- model name;
- fields;
- rendered question/front;
- rendered answer/back;
- CSS;
- card ID.

## Sampling

Do not inspect an entire large deck.

Initial deterministic strategy:

1. find card IDs for the selected deck;
2. take a bounded sample;
3. fetch `cardsInfo` for that sample;
4. aggregate counts by `modelName`;
5. keep one or more representative cards per model/template where practical.

The sample size should be configurable in code and covered by tests.

A distribution such as:

```text
Hebrew Vocabulary  18/24 sampled cards
Hebrew Verbs        5/24
Basic               1/24
```

is evidence only. Collector must not automatically select the first model.

## Preview

For a chosen representative card show:

- model name;
- deck name;
- rendered front;
- rendered back;
- optionally template/card ordinal information if available;
- a note that preview content comes from the user's existing Anki card.

Avoid attempting to recreate Anki rendering by manually copying template CSS into Collector.

The purpose is recognition:

> "Yes, this is the kind of card I already use."

## Privacy

Rendered card content is read locally from AnkiConnect and remains local.

Do not log representative card contents to telemetry, public issues, or exported diagnostics.

## Tests

- mixed-model deck;
- empty deck;
- huge deck bounded sampling;
- repeated model counts;
- cards with multiple templates;
- cloze model sample;
- malformed/missing card in `cardsInfo`;
- deterministic sampling/order.

## Manual acceptance

Use at least one real deck that contains existing cards and confirm:

- model distribution is plausible;
- representative front/back matches what Anki shows;
- inspection does not change scheduling, fields, templates, or deck placement.
