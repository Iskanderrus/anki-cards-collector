# ACCP-014: Existing Anki note type mapping

## Goal

Let an export profile use the user's existing Anki note type and therefore its existing card templates/CSS.

## Dependencies

- ACCP-013.
- ACCP-011 recommended for configuration UX.

## Ownership modes

### Collector-managed

Collector Basic remains managed by Collector and may receive known schema/template migrations.

### User-owned

Collector may inspect but not mutate the model.

Selecting it never calls model-field-add or template/style update operations.

## Discovery

Query Anki for:

- model names;
- field names;
- templates for compatibility information.

A profile stores the chosen model and field mapping.

## Mapping

Map semantic values such as:

- Prompt
- Answer
- Canonical
- Observed
- Context
- Note
- Source

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

Before saving the profile, show:

- deck;
- model;
- field-to-field mapping;
- identity method;
- representative payload.

Do not attempt to clone/render arbitrary Anki CSS inside the side panel.

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
