# ACCP-016: Read-only live Anki catalog

## Goal

Create one reusable discovery layer that exposes the user's real Anki decks and note types to Collector configuration without mutating the collection.

## Dependencies

- ACCP-008/009 AnkiConnect reliability baseline.
- No dependency on the sidebar redesign.

## AnkiConnect surface

Use read-only calls:

- `deckNamesAndIds`;
- `modelNamesAndIds`;
- `modelFieldNames`;
- `modelFieldsOnTemplates`;
- `modelTemplates`;
- `modelStyling`.

The implementation should keep raw AnkiConnect response handling inside the Anki integration layer.

## Domain model

Introduce normalized discovery types, for example:

```text
AnkiCatalog
  decks[]
    id
    name
  models[]
    id
    name
    fields[]
    fieldsOnTemplates
    templates
    css
  refreshedAt
  connectionState
```

The final shape may split summary and lazy-loaded model details so opening settings does not fetch every template/CSS object unnecessarily.

## Loading strategy

1. Ping AnkiConnect.
2. Load deck and model summaries.
3. Load model details lazily when a user inspects/chooses a model.
4. Allow explicit refresh.
5. Preserve saved export profiles if refresh fails.

Do not treat transient Anki unavailability as a reason to delete or reset saved configuration.

## UI contract

The catalog should support:

- deck dropdown populated from real decks;
- model dropdown populated from real note types;
- explicit "Refresh from Anki";
- connection state;
- stale/live indicator where useful.

Creating a new deck, if supported later, is a separate explicit action rather than typing an arbitrary name into an existing-deck selector.

## Tests

- deck/model normalization;
- IDs preserved as strings/numbers without lossy coercion;
- unavailable Anki;
- partial model-detail failure;
- refresh preserving existing saved config;
- models with multiple templates;
- empty collection.

## Manual acceptance

Against real Anki Desktop:

- discovered deck list matches visible decks;
- discovered model list contains known note types;
- selected model field/template metadata matches Anki;
- no collection mutation occurs.

## Non-goals

- choosing a target model automatically;
- card sampling/render preview;
- field mapping;
- routing Ready items.

Those belong to ACCP-017/013/014.
