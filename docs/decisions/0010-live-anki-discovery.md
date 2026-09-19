# ADR 0010: Treat live Anki discovery as read-only evidence, not inferred user intent

**Status:** Accepted

## Context

Collector needs to work with a user's real Anki collection rather than asking the user to type deck/model names manually.

AnkiConnect can expose live deck names, model names, model fields, template usage, templates, styling, and rendered card data. It can also search cards in a deck and return the rendered question/answer, CSS, model name, fields, and deck name for representative cards.

Those capabilities are useful for configuration, but they do not by themselves reveal the user's intent.

A deck can contain several note types. A note type can create several card templates. The most common note type in a deck is not necessarily the note type the user wants Collector to target.

## Decision

Collector will introduce a read-only Anki discovery/catalog boundary.

Discovery may inspect:

- deck names and IDs;
- model names and IDs;
- field names;
- fields used by templates;
- card templates;
- model styling;
- bounded samples of cards from a selected deck;
- rendered front/back content and model/deck metadata for those samples.

Discovery must not:

- create or delete decks;
- modify note-type fields;
- rewrite templates/CSS;
- move cards;
- select a target model solely because it is statistically most common.

The discovery result is advisory evidence used to populate choices and previews.

The user explicitly confirms:

- destination deck;
- target note type;
- field mapping;
- saved export profile.

Saved export-profile configuration remains authoritative when Anki is temporarily unavailable. Live discovery can refresh/revalidate it but does not silently replace it.

## Consequences

Collector can offer real deck/model choices instead of free-text guesses.

Deck/model analysis can make profile setup easier without turning heuristics into hidden routing decisions.

Representative card previews can show how existing cards are actually rendered, while ACCP-014 still reuses the user's existing note type instead of copying its CSS into Collector Basic.

Anki discovery becomes a reusable service with explicit loading/offline/error states rather than ad hoc calls from React components.

ACCP-016 implements the catalog, ACCP-017 implements bounded deck/model analysis and representative previews, and ACCP-018 combines them into guided profile setup.
