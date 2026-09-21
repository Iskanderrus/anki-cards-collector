# ACCP-018: Guided export-profile setup

## Goal

Combine live Anki discovery, deck/model analysis, existing note-type mapping, and export profiles into one safe setup flow.

## Dependencies

- ACCP-016 live catalog;
- ACCP-017 deck/model analysis;
- ACCP-013 export-profile persistence/routing;
- ACCP-014 user-owned note-type mapping;
- ACCP-011 for the final settings/navigation shell.

## Flow

### 1. Connect

Show Anki connection state.

If Anki is unavailable:

- keep saved profiles visible;
- explain that live validation/preview requires Anki Desktop + AnkiConnect;
- do not erase configuration.

### 2. Choose language

Language is stored on the export profile itself. Common languages use a guided label/code choice; an explicit custom code remains available for other languages.

Legacy `defaultLanguage` is preserved as a fallback. Existing profiles are not assigned a language merely because a global language happened to be configured.

### 3. Choose destination deck

Populate from the live catalog.

Example:

```text
Deck
▾ Hebrew RU
  Serbian RU
  Spanish RU — Uruguay
```

### 4. Inspect note types used in the deck

Use ACCP-017 analysis.

Example:

```text
Used in this deck (sample)
● Hebrew Vocabulary   75%
○ Hebrew Verbs        21%
○ Basic                4%
```

Percentages/counts are advisory only.

### 5. Choose intended note type explicitly

The user confirms the model.

Do not auto-select merely because one model dominates the sample.

### 6. Show representative existing card

Display a sampled card's rendered front/back so the user can recognize the intended layout.

Provide another sample when available.

### 7. Configure field mapping

For a user-owned model:

```text
Collector semantic value -> existing Anki field
Canonical                -> Hebrew
Answer/learner note      -> Russian
Context                  -> Example
Source                   -> Source
```

Validation comes from ACCP-014.

### 8. Preview outgoing payload

Show representative Collector values placed into the target fields.

This preview is a data-placement preview, not a duplicate Anki renderer.

### 9. Save profile and routing

Save:

- profile name;
- deck;
- model;
- ownership mode;
- field mapping;
- identity strategy.

Configure or update the corresponding language route through the existing ACCP-013 routing model, for example `he -> Hebrew`. The guided UI does not duplicate routing rules.

## Revalidation

Profiles should expose:

- last live validation time;
- refresh/revalidate action;
- clear warnings when deck/model/fields no longer exist.

A stale profile is not silently rewritten.

## Tests

Browser E2E:

- Anki unavailable;
- choose deck/model;
- mixed-model deck;
- representative card preview;
- invalid mapping blocked;
- save/reopen profile;
- refresh after model changes;
- keyboard-only setup.

## Manual acceptance

Configure at least two real profiles, for example Hebrew and Serbian, using existing decks and note types, then export one item through each profile without changing either user-owned note type.


## Migration and compatibility

ACCP-018 is deliberately conservative:

- existing lexical units keep their current language;
- existing language routes are preserved unless the user explicitly replaces a route while saving a guided profile;
- legacy `defaultLanguage` remains stored as a capture fallback;
- old profiles are not assigned a first-class language from `defaultLanguage`;
- name-only or otherwise incomplete mapped profiles remain preserved and continue to fail closed under ACCP-014 until live identity is reconfirmed;
- Anki being offline never deletes or rewrites saved profile configuration.

## Implementation decisions

- `ExportProfile.language` is first-class for newly guided profiles.
- `CollectorSettings.captureProfileId` selects the active profile whose language is used for ordinary capture.
- if an older profile has no first-class language, exactly one existing language route may supply its capture language; ambiguous legacy routes do not;
- guided mapped profiles persist live deck/model IDs, `collector-tag` identity strategy, field mapping, and the last successful live-validation time;
- representative study content stays ephemeral in the UI and is never written into settings, backups, or diagnostics;
- revalidation never rewrites IDs or mappings from same-name live objects;
- for profiles with durable exported/reserved bindings, deck/model identity edits are blocked in place; a new profile must be created instead;
- a field remap on an already-used profile requires explicit consequence acknowledgement because future updates will use the new mapping while existing Anki note content is not silently rewritten.
