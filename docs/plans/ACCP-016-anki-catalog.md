# ACCP-016: Read-only live Anki catalog

## Status

Implemented in code; real-Anki manual acceptance remains required before the issue is closed.

## Goal

Create one reusable discovery layer that exposes the user's real Anki decks and note types to Collector configuration without mutating the collection.

## Dependencies

- ACCP-008/009 AnkiConnect reliability baseline.
- No dependency on the sidebar redesign.

## Implemented AnkiConnect surface

Read-only calls:

- `deckNamesAndIds`;
- `modelNamesAndIds`;
- `modelFieldNames`;
- `modelFieldsOnTemplates`;
- `modelTemplates`;
- `modelStyling`.

Raw response handling stays inside the Anki integration/catalog layer.

## Domain model

The implementation exposes normalized:

- catalog snapshots with AnkiConnect version, decks, models, and refresh timestamp;
- model details with fields, templates, fields used on each side, CSS, and refresh timestamp;
- live/stale/unavailable result states.

Anki object IDs preserve their returned string/number representation instead of coercing them through a new numeric format.

## Loading and stale behavior

The catalog service:

1. pings AnkiConnect;
2. loads deck/model summaries;
3. inspects model details only when requested;
4. keeps the last successful snapshot/detail in memory;
5. persists normalized catalog/model metadata in extension-local storage;
6. restores that metadata after a side-panel remount when Anki is temporarily unavailable;
7. returns stale cached data together with the current refresh error;
8. leaves saved Collector settings untouched when Anki is unavailable.

The persisted stale cache contains only deck/model discovery metadata, template definitions, and model styling. It does not contain note/card contents.

Cache read/write failure never downgrades a successful live discovery result.

The side panel exposes a separate **Refresh from Anki** control and discovery status. Discovery loading does not reuse the export busy state.

## UI

The current settings surface now:

- keeps the saved deck/note type visible before discovery;
- can populate deck and note-type selectors from live Anki data;
- marks a saved value when it is absent from the current live catalog;
- shows inspected field names, template names, and whether CSS styling was returned;
- states explicitly that catalog refresh is read-only;
- can restore the last successful catalog as stale data after a panel remount/offline refresh.

The final profile-setup UX remains ACCP-018.

## Tests

Automated coverage includes:

- deck/model normalization;
- string and numeric ID preservation;
- unavailable Anki;
- stale snapshot after a failed refresh;
- persistent stale restore after service/panel remount;
- persistent model-detail restore;
- cache-write failure not affecting live discovery;
- field/template/styling normalization;
- partial model-detail failure with cached fallback;
- malformed IDs/template metadata;
- empty collection;
- exact AnkiClient read-only actions and parameters.

## Manual acceptance

Follow [manual Anki catalog acceptance](../manual-anki-catalog-acceptance.md).

Against real Anki Desktop verify:

- discovered deck list matches visible decks;
- discovered model list contains known note types;
- selected model field/template metadata matches Anki;
- stale catalog survives closing/reopening the side panel with Anki stopped;
- no collection mutation occurs.

## Non-goals

- choosing a target model automatically;
- card sampling/render preview;
- field mapping;
- routing Ready items.

Those belong to ACCP-017/013/014.
