# ACCP-013: Export profiles and multi-deck routing

## Goal

Support several Anki decks/models safely in one Collector corpus and one Ready batch.

## Dependencies

- ACCP-001/008/009 foundations complete.
- ACCP-016 supplies live read-only deck/model choices.

## Storage model

Introduce:

### ExportProfile

Configuration stored with extension settings:

- id;
- name;
- deckName and, where useful, deck ID;
- modelName and, where useful, model ID;
- mode: Collector-managed or mapped user model;
- optional mapping/profile metadata.

### LanguageRoute

- normalized language code;
- default profileId.

### ExportBinding

Persistent per lexical unit:

- lexicalUnitId;
- profileId;
- deck/model snapshot needed for safe updates;
- ankiNoteId.

The final schema may use a dedicated IndexedDB table rather than putting operational metadata directly on LexicalUnit.

## Routing

Resolve:

1. explicit item override/binding;
2. language route;
3. fallback profile.

Once exported, changing a language default does not silently move the existing note.

## Live choices

ACCP-013 consumes ACCP-016 catalog data instead of implementing Anki discovery ad hoc.

Existing destination choices should come from real Anki deck/model data whenever Anki is available.

Creating a new deck, if supported, is a separate explicit action.

ACCP-017 may show which note types are used in a deck, but profile routing does not infer a model from that distribution.

## Batch export

1. Resolve effective profile for every Ready item.
2. Block items without a valid route.
3. Group by profile.
4. Validate each destination/model.
5. Export with existing per-item isolation.
6. Persist binding/note ID after each successful item.

## Destination change

For an exported item, changing profile is explicit.

If only deck changes and model remains compatible, offer a deliberate move operation.

If model changes, require ACCP-014 compatibility/mapping validation rather than silently rewriting.

## Migration

Convert current global deck/model settings into one default export profile.

Migrate existing `ankiNoteId` relationships into bindings without changing note identity.

Backups must preserve the information necessary to restore safe routing/bindings.

## Tests

- mixed Hebrew/Serbian/Spanish batch routes correctly;
- fallback profile;
- explicit override;
- route change does not move existing note;
- intentional move;
- stale Anki note recovery still works;
- live catalog choice validation;
- backup/migration.

## Manual acceptance

Use at least two real destination decks in one Ready batch and verify each item reaches the intended deck without changing the user's note-type schema.
