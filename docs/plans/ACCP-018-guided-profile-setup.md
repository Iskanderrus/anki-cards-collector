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

### 2. Choose destination deck

Populate from the live catalog.

Example:

```text
Deck
▾ Hebrew RU
  Serbian RU
  Spanish RU — Uruguay
```

### 3. Inspect note types used in the deck

Use ACCP-017 analysis.

Example:

```text
Used in this deck (sample)
● Hebrew Vocabulary   75%
○ Hebrew Verbs        21%
○ Basic                4%
```

Percentages/counts are advisory only.

### 4. Choose intended note type explicitly

The user confirms the model.

Do not auto-select merely because one model dominates the sample.

### 5. Show representative existing card

Display a sampled card's rendered front/back so the user can recognize the intended layout.

Provide another sample when available.

### 6. Configure field mapping

For a user-owned model:

```text
Collector semantic value -> existing Anki field
Canonical                -> Hebrew
Answer/learner note      -> Russian
Context                  -> Example
Source                   -> Source
```

Validation comes from ACCP-014.

### 7. Preview outgoing payload

Show representative Collector values placed into the target fields.

This preview is a data-placement preview, not a duplicate Anki renderer.

### 8. Save profile and routing

Save:

- profile name;
- deck;
- model;
- ownership mode;
- field mapping;
- identity strategy.

Optionally assign the profile to a language route such as `he -> Hebrew`.

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
