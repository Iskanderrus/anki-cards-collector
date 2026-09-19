# ACCP-004: Explicit merge and split

## Goal

Make lexical-unit identity management deliberate and support separate senses/homographs that share the same written canonical form.

## Dependencies

- ACCP-003.

## Domain changes

The current content-key uniqueness rule cannot represent two intentionally distinct units with the same canonical text/language.

The implementation needs an identity model where lexical-unit ID is primary and canonical text is no longer globally unique within a language.

A normalized canonical index may remain non-unique for discovery.

## Merge

Merge preview shows:

- both canonical targets;
- notes;
- statuses;
- occurrences;
- export bindings/Anki identity.

Rules:

- preserve a single existing exported identity when only one side is exported;
- refuse implicit merge when both sides point to different Anki notes/bindings;
- move occurrences without changing their IDs;
- re-review resulting study content.

## Split

The user selects occurrences to move to a new lexical unit.

Split must:

- create a new stable lexical-unit ID;
- preserve selected occurrence IDs;
- leave the original unit valid;
- require explicit canonical/note review for the new unit;
- avoid copying Anki identity to both sides.

## Storage/migration

Revise indexes/content keys without losing existing IDs.

Backup format may need a new version if uniqueness assumptions are serialized or validated differently.

## Tests

- merge one exported + one unexported;
- merge conflict with two Anki identities;
- split subset of occurrences;
- same canonical text on two distinct units;
- backup round-trip and IndexedDB migration.
