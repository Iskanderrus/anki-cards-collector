# ACCP-004: Explicit merge and split

## Goal

Make lexical-unit identity management deliberate and support separate senses/homographs that share the same written canonical form.

## Dependencies

- ACCP-003.

## Domain changes

The current content-key uniqueness rule cannot represent two intentionally distinct units with the same canonical text/language.

The implementation needs an identity model where lexical-unit ID is primary and canonical text is no longer globally unique within a language.

A normalized canonical index may remain non-unique for discovery.

### Invariant audit

The pre-migration audit traced canonical uniqueness through:

- Dexie schema v4: `lexicalUnits.&contentKey`;
- ordinary capture direct-owner lookup;
- occurrence-owner fallback;
- ACCP-019 staged classification canonical-owner map;
- ACCP-021 transaction-time batch ownership;
- ACCP-003 canonicalization preview/update consolidation;
- ACCP-012 review-session ID reconciliation;
- export bindings and reserved identity state;
- backup validation/restore conflict detection;
- migration fixtures and repository/browser tests.

Post-ACCP-004 invariants:

- `LexicalUnit.id` is stable primary identity;
- `contentKey` remains derived from normalized language + canonical text, but is a non-unique lookup key;
- canonical editing preserves the current lexical ID and never implies merge;
- multiple plausible owners make capture ambiguous unless exact evidence proves one owner;
- merge/split are explicit, transactional, stale-preview-safe identity operations;
- occurrence IDs never change when ownership moves;
- merge/split never call Anki directly;
- changed study evidence returns affected units to Inbox;
- reserved or incompatible external identity blocks unsafe merge;
- split never copies external identity to the new lexical unit.

ADR 0012 records the architecture decision.

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
