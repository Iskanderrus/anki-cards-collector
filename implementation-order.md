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

Creates the normalized read-only Anki discovery boundary.

Real-Anki acceptance verifies decks/models/fields/templates without mutating the collection.

### ACCP-002 — best occurrence selection

Remains domain logic independent from React and Anki.

### ACCP-019 — staged batch-capture pipeline

Creates the source-agnostic candidate/staging/commit boundary.

Can be developed in parallel with ACCP-016 and ACCP-002.

It must land before Duolingo batch extraction so source-specific code never writes directly to the corpus.

---

## Gate B — destination routing, source adapters, and discovery evidence

### ACCP-013 — export profiles / multi-deck routing

Depends on ACCP-016.

Replaces the unsafe single-global-deck assumption and defines persisted routing/bindings.

### ACCP-017 — deck/model analysis and representative existing-card preview

Depends on ACCP-016.

Can run in parallel with much of ACCP-013.

### ACCP-020 — Duolingo visible lesson backfill

Depends on ACCP-019.

Implements one-shot visible scan plus explicitly started/stopped visible-DOM session capture.

It can run in parallel with the Anki profile work because it only produces staged source evidence.

---

## Gate C — interaction shell and canonical review

### ACCP-011 — sidebar redesign

Depends on ACCP-013's profile/destination model.

Consumes ACCP-002 selected-occurrence information.

Creates the compact queue + focused detail/settings structure used by normal review and staged-candidate review.

### ACCP-003 — canonicalization workflow

Depends on ACCP-002 and should target the ACCP-011 detail view.

---

## Gate D — existing Anki models, guided setup, and backfill review

### ACCP-014 — existing note type mapping

Depends on ACCP-013 and ACCP-016.

Consumes ACCP-017 representative-card evidence.

### ACCP-018 — guided export-profile setup

Depends on ACCP-016, ACCP-017, ACCP-013, ACCP-014, and the ACCP-011 settings shell.

### ACCP-021 — batch backfill review and import

Depends on ACCP-019, ACCP-020, and ACCP-011.

Builds the staged-candidate UI and commits selected evidence into the normal corpus.

Its full original-workflow acceptance should run after ACCP-018 so accepted Hebrew/Serbian/etc. material can be exported through a real existing user note type and deck.

### ACCP-012 — onboarding and user journey

Land after guided profile setup and backfill review are stable so onboarding teaches the final workflows rather than temporary configuration.

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
4. ACCP-019 — staged batch-capture pipeline
5. ACCP-013 — export profiles / multi-deck routing
6. ACCP-017 — deck/model analysis + existing-card preview
7. ACCP-020 — Duolingo visible lesson backfill
8. ACCP-011 — sidebar redesign
9. ACCP-003 — canonicalization workflow
10. ACCP-014 — existing note type mapping
11. ACCP-018 — guided export-profile setup
12. ACCP-021 — batch backfill review/import
13. ACCP-012 — onboarding/user journey
14. ACCP-004 — explicit merge/split
15. ACCP-005 — learning-card policy v2
16. ACCP-006 — morphology assistance
17. ACCP-007 — learning-value decision

ACCP-010, ACCP-016, ACCP-002, and ACCP-019 are safe to develop in parallel.

ACCP-017, ACCP-020, and much of ACCP-013 can overlap once their respective foundation contracts are stable.

---

## Original Duolingo-to-Anki acceptance path

The end-to-end motivating workflow is considered complete only when the following chain has passed real acceptance:

```text
ACCP-019 staged batch pipeline
    ↓
ACCP-020 visible Duolingo backfill
    ↓
ACCP-021 staged review/import
    ↓
normal lexical/card review
    ↓
ACCP-013/014/016/017/018 export profile
    ↓
existing Anki deck + existing user note type
```

The acceptance run should prove:

- only user-visible Duolingo material is collected;
- no private API/network interception is used;
- duplicates are not silently multiplied;
- imported candidates do not become Ready automatically;
- chosen material reaches the intended language deck/profile;
- the user's existing note type/templates/CSS remain unchanged;
- Anki note identity remains idempotent.

---

## Quality gates for every item

Every implementation PR preserves:

```bash
npm run check
```

UI changes keep Chromium E2E and accessibility checks green.

Storage/backup changes require:

- frozen migration fixture where schema changes;
- deterministic backup migration/validation;
- round-trip tests.

Anki discovery/routing/model work requires real-Anki manual acceptance in addition to mocks.

Backfill/source-session work requires browser-level privacy/permission tests in addition to DOM fixtures.

No item may silently:

- duplicate study material;
- move an exported card to a different deck;
- mutate a user-owned Anki model;
- infer a target model solely from deck popularity;
- turn staged source candidates directly into Ready cards;
- rewrite lexical identity from an unapproved suggestion.
