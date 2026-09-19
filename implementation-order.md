# Implementation order

This file is the dependency-aware execution order for current Collector work.

It is intentionally stricter than issue-number order. Some work can run in parallel; later work should not be built on UI/data assumptions that are about to be replaced.

## Completed foundation

The following work is already part of the current baseline:

- **ACCP-001** — canonical lexical units vs observed forms, including real v1 -> v2 migration acceptance;
- **ACCP-008** — correct browser fetch binding for real AnkiConnect export;
- **ACCP-009** — stale/deleted Anki note recovery using real AnkiConnect behavior;
- **ACCP-015** — UX/export planning baseline and repository implementation order.

---

## Gate A — low-coupling groundwork

### ACCP-010 — brand assets

Can merge independently.

### ACCP-016 — read-only live Anki catalog

Implement before profile routing/configuration UI.

This creates the normalized, read-only discovery boundary used by later Anki work.

Real-Anki acceptance verifies decks/models/fields/templates without mutating the collection.

### ACCP-002 — best occurrence selection

Can run in parallel with ACCP-010/016.

It remains domain logic independent from React and Anki.

---

## Gate B — export destination model and deck evidence

### ACCP-013 — export profiles / multi-deck routing

Depends on ACCP-016 for live destination/model choices.

This replaces the unsafe single-global-deck assumption and defines persisted routing/bindings.

Manual acceptance uses at least two real decks in one batch.

### ACCP-017 — deck/model analysis and representative existing-card preview

Depends on ACCP-016.

Can run in parallel with much of ACCP-013.

It samples cards read-only, reports note-type usage, and shows representative existing front/back content.

It must not automatically select a model from popularity.

---

## Gate C — interaction shell and canonical review

### ACCP-011 — sidebar redesign

Depends on ACCP-013's profile/destination model.

Consumes ACCP-002 selected-occurrence information.

Creates the compact queue + focused detail/settings structure for later configuration UX.

### ACCP-003 — canonicalization workflow

Depends on ACCP-002 and should target the ACCP-011 detail view.

---

## Gate D — existing Anki models and guided setup

### ACCP-014 — existing note type mapping

Depends on ACCP-013 and ACCP-016.

Consumes ACCP-017 representative-card evidence.

Proves Collector can write mapped values into a user-owned note type without mutating its fields/templates/CSS.

### ACCP-018 — guided export-profile setup

Depends on ACCP-016, ACCP-017, ACCP-013, ACCP-014, and the ACCP-011 settings shell.

Combines:

- live deck selection;
- model distribution;
- representative existing-card preview;
- explicit note-type choice;
- field mapping;
- payload preview;
- profile save/revalidation.

### ACCP-012 — onboarding and user journey

Land after the real profile-setup flow is stable so onboarding teaches the final workflow rather than temporary configuration behavior.

---

## Gate E — corpus operations and card quality

### ACCP-004 — explicit merge and split

Depends on ACCP-003.

Requires migration/backup coverage if canonical uniqueness assumptions change.

### ACCP-005 — learning-card policy v2

Depends on ACCP-002 and ACCP-003.

Must preserve review/export parity.

---

## Gate F — optional assistance and learning-value decisions

### ACCP-006 — morphology/canonical-form assistance

Depends on ACCP-003 and ACCP-004.

### ACCP-007 — learning-value decision

Depends on ACCP-002, ACCP-004, and ACCP-005.

---

## Recommended linear merge sequence

When one linear order is needed:

1. ACCP-010 — brand assets
2. ACCP-016 — live Anki catalog
3. ACCP-002 — best occurrence selection
4. ACCP-013 — export profiles / multi-deck routing
5. ACCP-017 — deck/model analysis + existing-card preview
6. ACCP-011 — sidebar redesign
7. ACCP-003 — canonicalization workflow
8. ACCP-014 — existing note type mapping
9. ACCP-018 — guided export-profile setup
10. ACCP-012 — onboarding/user journey
11. ACCP-004 — explicit merge/split
12. ACCP-005 — learning-card policy v2
13. ACCP-006 — morphology assistance
14. ACCP-007 — learning-value decision

ACCP-016, ACCP-002, and ACCP-010 are safe to develop in parallel.

ACCP-017 and much of ACCP-013 can overlap once the ACCP-016 catalog contract is stable.

---

## Quality gates for every item

Every implementation PR preserves:

```bash
npm run check
```

UI changes keep Chromium E2E and accessibility checks green.

Storage/backup changes require:

- frozen migration fixture;
- deterministic backup migration/validation;
- round-trip tests.

Anki discovery/routing/model work requires real-Anki manual acceptance in addition to mocks.

Discovery acceptance must prove read-only behavior.

No item may silently:

- duplicate study material;
- move an exported card to a different deck;
- mutate a user-owned Anki model;
- infer a target model solely from deck popularity;
- rewrite lexical identity from an unapproved suggestion.
