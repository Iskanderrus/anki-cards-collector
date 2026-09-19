# Anki export strategy

## Principle

Collector should separate three concerns:

1. **Learning content** — what the learner captured and what the card policy proposes.
2. **Destination** — which Anki deck/profile receives the item.
3. **Presentation** — which Anki note type/template renders it.

Today those concerns are too tightly coupled through one global deck name and one Collector-managed model.

ACCP-013 and ACCP-014 split them deliberately.

## Current behavior and limitation

Current settings contain one global language, one deck name, and one note type.

That means all Ready items in one batch use the same destination settings. A multilingual queue can therefore be routed incorrectly if the user forgets to change the global deck.

Existing exported notes also do not move just because the global deck string changes; updating fields and moving a card are different Anki operations.

The current client may add Collector fields to a selected model. That behavior is acceptable only for a Collector-owned model. It is not safe for arbitrary user-owned note types.

## Export profiles

An export profile is a reusable destination/presentation configuration.

Conceptually:

```text
ExportProfile
  id
  name
  deck
  model
  field mapping / managed-model mode
  optional language route
```

Examples:

```text
Hebrew
  deck: Hebrew RU
  model: existing Hebrew model

Serbian
  deck: Serbian RU
  model: existing Serbian model

Spanish
  deck: Spanish RU — Uruguay
  model: existing Spanish model
```

Profiles are discovered/configured against real Anki decks and models, not entered as unvalidated free text.

## Routing order

The effective profile is resolved in this order:

1. explicit per-item override;
2. language route;
3. global fallback profile.

A route change must not silently move an already-exported note.

Once an item has an export binding, later global configuration changes do not reinterpret its history.

## Export binding

Destination state is not part of lexical identity.

A separate export binding should track the effective relationship between a lexical unit and Anki.

Conceptually:

```text
ExportBinding
  lexicalUnitId
  profileId
  deckName at binding time
  modelName at binding time
  ankiNoteId
```

This keeps language content independent from where it is currently studied.

An explicit destination change can update the binding after user confirmation.

## Batch behavior

A batch may contain several profiles.

Collector should group Ready items by effective profile and prepare each destination independently.

One failing profile must not prevent unrelated profile groups from exporting.

Progress should identify both item and destination.

## Collector-managed model

Collector Basic remains supported.

Collector owns its:

- fields;
- template;
- CSS;
- migration rules.

Collector may add fields or migrate the exact known default template because it owns that schema.

## User-owned models

An existing user model is read-only from Collector's perspective.

Collector may inspect:

- model name;
- fields;
- templates;

but must not add/remove/reorder fields or rewrite template/CSS simply because the user selected it.

Integration happens through explicit field mapping.

## Field mapping

Collector semantic values include:

- prompt;
- answer;
- canonical form;
- observed form;
- context;
- learner note;
- source.

A profile maps those values into fields that already exist on the target model.

Mappings are validated before the profile can be used for export.

## Stable identity

Collector must preserve idempotent export even when using a user-owned model.

For Collector Basic, the existing CollectorID field remains valid.

For user-owned models, the preferred identity fallback is a reserved Collector tag containing the stable lexical-unit ID. This avoids requiring Collector to add a hidden field to the user's model.

The local Anki note ID remains the fastest update path. If it becomes stale, Collector can search by its reserved identity tag before creating a replacement.

## Preview

Before saving a custom profile, Collector should show:

- deck;
- model;
- field mapping;
- identity strategy;
- representative payload values.

The preview is about data placement, not trying to reproduce the entire Anki renderer inside the browser.

## Safety rules

- never silently mutate a user-owned note type;
- never send every Ready item to the currently selected deck when per-item routes differ;
- never silently move an already-exported card because a default route changed;
- never create a replacement note before stable identity lookup;
- never claim a mapping is valid until required fields are checked against the live model.
