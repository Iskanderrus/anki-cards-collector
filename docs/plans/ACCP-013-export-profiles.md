# ACCP-013: Export profiles and multi-deck routing

## Goal

Support several Anki decks/models safely in one Collector corpus and one Ready batch.

## Dependencies

- ACCP-001/008/009 foundations complete.

## Storage model

Introduce:

### ExportProfile

Configuration stored with extension settings:

- id;
- name;
- deckName;
- modelName;
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

## Anki discovery

Use AnkiConnect to discover live:

- deck names;
- model names.

Deck selection should use discovered choices. Creating a new deck, if supported, is an explicit action rather than an accidental free-text typo.

## Batch export

1. Resolve effective profile for every Ready item.
2. Block items without a valid route.
3. Group by profile.
4. Ensure each destination/model as required.
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
- backup/migration.
