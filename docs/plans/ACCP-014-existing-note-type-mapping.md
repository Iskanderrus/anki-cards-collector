# ACCP-014: Existing Anki note type mapping

## Goal

Let an export profile use the user's existing Anki note type and therefore its existing card templates/CSS.

## Dependencies

- ACCP-013.
- ACCP-016 live model metadata.
- ACCP-017 representative deck/model evidence.
- ACCP-011 recommended for final configuration UX.

## Ownership modes

### Collector-managed

Collector Basic remains managed by Collector and may receive known schema/template migrations.

### User-owned

Collector may inspect but not mutate the model.

Selecting it never calls model-field-add or template/style update operations.

## Discovery

Consume ACCP-016 metadata for:

- model names/IDs;
- field names;
- fields used by templates;
- templates;
- CSS styling.

Consume ACCP-017 representative card previews to help the user confirm they selected the intended model.

A profile stores the confirmed model and field mapping.

## Mapping

Map Collector semantic values such as:

- Prompt;
- Answer;
- Canonical;
- Observed;
- Context;
- Note;
- Source;

to fields that already exist on the user model.

Initial implementation should prefer simple explicit mappings over a template-expression language.

Required mapping depends on the chosen export/card profile; validation must explain missing fields before export.

## Stable identity

For Collector Basic, keep the CollectorID field.

For user-owned models:

- add a reserved tag such as `collector::id::<lexicalUnitId>`;
- retain local Anki note ID;
- on stale note ID, search by reserved identity tag before creating a replacement.

Never require adding a hidden field to the user's model merely for Collector.

## Preview

Two previews serve different purposes:

1. ACCP-017 shows a real existing Anki card so the user recognizes the note type/style.
2. ACCP-014 shows where Collector semantic values will be written.

Do not clone arbitrary Anki CSS/template HTML into Collector Basic.

The actual exported note should use the user's selected note type so Anki renders it with that note type's existing templates and styling.

## Update behavior

Updating a mapped note writes only configured fields and Collector-owned tags.

Do not clear unmapped user fields.

Do not rewrite templates/CSS.

## Tests

- mapped export to user model;
- no model mutation calls;
- missing-field validation;
- custom template untouched;
- stale-note recovery by identity tag;
- multiple-card-template model does not break note update;
- Collector Basic path remains green.

## Manual acceptance

Export through a real non-Collector note type and confirm:

- rendered card uses the existing Anki layout;
- note type/templates/CSS are unchanged;
- only mapped fields and Collector-owned tags change.


## Implementation status

Implemented on `accp-014-existing-note-type-mapping`:

- `ExportProfile` can persist an explicit semantic-field mapping for a user-owned Anki note type;
- mapping normalization/validation requires Prompt + Answer, rejects duplicate target fields, and revalidates configured targets against live `modelFieldNames`;
- configured mapped profiles are valid routing destinations while incomplete legacy mapped profiles remain preserved but are not selected for new unbound exports;
- user-owned model setup is read-only: Collector checks live deck/model IDs plus fields but does not call model creation, field-add, template update, or styling update actions;
- a mapped profile is routable only after both live deck ID and live model ID have been confirmed; name-only legacy profiles remain preserved but cannot write until reconfirmed;
- every mapped export revalidates the saved deck/model IDs, and export bindings pin those IDs alongside names so later profile edits cannot reinterpret an existing mapped destination;
- normal multi-template user models remain supported, while cloze templates are detected read-only and rejected before any note mutation because Collector does not yet generate cloze semantics;
- `modelFieldsOnTemplates` must confirm that the mapped Prompt field participates in at least one question side;
- the actual mapped note is checked with AnkiConnect `canAddNotes` before ACCP-013 persists a durable reservation, so ordinary mapping/card-generation errors cannot create a reconciliation lock;
- mapped note creation writes only configured fields plus Collector-owned tags;
- mapped note updates write only configured fields and add a reserved Collector identity tag whose lexical-unit ID is encoded as exact hex over JavaScript string code units;
- stale recovery uses an anchored exact tag-regex query, so restored IDs containing Anki wildcard/search characters and child tags cannot alias another identity;
- the identity tag is established before mapped field updates so an interrupted update can be retried safely;
- stale local note IDs recover by the exact reserved identity tag, with duplicate-tag ambiguity and wrong-model recovery treated as blocking errors;
- mapped note creation allows equal first-field values because idempotency is based on the reserved Collector identity rather than user-model first-field uniqueness;
- the normal Ready-card flow exports fully configured mapped profiles instead of treating every user-owned note as an immutable legacy card;
- exported mapped notes remain pinned to their confirmed user-model destination in the current UI rather than offering the Collector-Basic deck-move control;
- settings/backup round-trips preserve field mappings and binding-pinned deck/model IDs;
- unit and browser coverage exercise mapped routing, live-field validation, read-only model handling, mapped-only payloads, stale identity recovery, tag-first retry safety, and the normal Ready-card send path.

ACCP-018 still owns the guided UI for selecting a live note type and building this mapping. ACCP-014 intentionally provides the safe storage/runtime/export boundary first.

### Remaining acceptance gate

Before closing ACCP-014, run the manual real-Anki acceptance from this plan against an existing non-Collector note type and record:

- exact deck + note type used;
- mapped fields;
- successful create/update/retry behavior;
- note type field list/templates/CSS before and after;
- confirmation that unmapped fields remain unchanged;
- confirmation that the reserved Collector identity tag is present.


### Review remediation

The deep review of head `35991a0d803d6d3825a8e27501f0de4a4fc8bae3` identified three blocking gaps. The implementation now closes them as follows:

- **Confirmed Anki object identity:** mapped profiles require both `deckId` and `modelId` to become routable; bindings snapshot those IDs and restore/reconciliation/consolidation logic treats them as part of destination identity.
- **Exact stale-note identity:** Collector encodes arbitrary lexical-unit IDs injectively into hex-only tag-safe text and searches with an anchored exact tag regex rather than ordinary hierarchical/wildcard tag matching.
- **Pre-reservation card compatibility:** live template field usage is checked and the actual mapped note is passed through non-mutating `canAddNotes` before a reservation is persisted.

The remaining gate is still real-Anki manual acceptance; remediation does not waive that requirement.
