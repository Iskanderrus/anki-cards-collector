# Anki export strategy

## Principle

Collector separates four concerns:

1. **Learning content** — what the learner captured and what the card policy proposes.
2. **Destination** — which Anki deck/profile receives the item.
3. **Presentation** — which Anki note type/template renders it.
4. **Discovery evidence** — what currently exists in the user's live Anki collection.

Those concerns must not collapse into one global deck/model setting.

## Live Anki discovery

ACCP-016 provides a read-only catalog of real decks and models.

Existing deck/model choices should come from live Anki whenever it is available rather than relying on free-text entry.

Discovery is advisory and refreshable.

A saved export profile remains the configured intent even if Anki is temporarily unavailable.

## Decks do not define card layout

A deck can contain several note types.

Therefore choosing a deck does not answer:

> "Which card layout should Collector use?"

ACCP-017 samples existing cards from the selected deck, aggregates their model names, and shows representative rendered cards.

That evidence helps the user choose the intended note type explicitly.

Collector never silently selects the most common model.

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

## Guided setup

ACCP-018 combines discovery and mapping:

```text
connect Anki
  -> choose live deck
  -> inspect note types used in deck
  -> choose target note type explicitly
  -> preview representative existing card
  -> map Collector semantic fields
  -> preview outgoing payload
  -> save export profile
  -> optionally assign language route
```

## Routing order

The effective profile is resolved in this order:

1. explicit per-item override;
2. language route;
3. global fallback profile.

A route change must not silently move an already-exported note.

Once an item has an export binding, later global configuration changes do not reinterpret its history.

## Export binding

Destination state is not part of lexical identity.

A separate export binding tracks the effective relationship between a lexical unit and Anki.

Conceptually:

```text
ExportBinding
  lexicalUnitId
  profileId
  deckName at binding time
  modelName at binding time
  ankiNoteId
```

An explicit destination change can update the binding after user confirmation.

## Batch behavior

A batch may contain several profiles.

Collector groups Ready items by effective profile and prepares each destination independently.

One failing profile must not prevent unrelated profile groups from exporting.

Progress identifies both item and destination.

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

- model name/ID;
- fields;
- fields used on templates;
- templates;
- styling;
- representative rendered cards.

But it must not add/remove/reorder fields or rewrite template/CSS simply because the user selected it.

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

## Existing-card preview vs outgoing payload preview

These are distinct:

- **existing-card preview** shows a real Anki card so the user recognizes the target style/model;
- **outgoing payload preview** shows what Collector values will be written to which fields.

Collector does not need to clone the user's CSS. By exporting through the existing note type, Anki uses its existing templates/CSS.

## Stable identity

Collector preserves idempotent export even when using a user-owned model.

For Collector Basic, the existing CollectorID field remains valid.

For user-owned models, the preferred identity fallback is a reserved Collector tag containing the stable lexical-unit ID.

The local Anki note ID remains the fastest update path. If it becomes stale, Collector searches by reserved identity tag before creating a replacement.

## Safety rules

- never silently mutate a user-owned note type;
- never infer a target note type solely from deck membership or popularity;
- never send every Ready item to the currently selected deck when per-item routes differ;
- never silently move an already-exported card because a default route changed;
- never create a replacement note before stable identity lookup;
- never claim a mapping is valid until required fields are checked against the live model;
- never discard a saved profile merely because Anki is temporarily offline.
