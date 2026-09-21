# Implementation order

This file is the dependency-aware execution order for current Collector work.

It is intentionally stricter than issue-number order. Some work can run in parallel; later work should not be built on UI/data assumptions that are about to be replaced.

## Completed foundation

The following work is already part of the current baseline:

- **ACCP-001** — canonical lexical units vs observed forms, including real v1 -> v2 migration acceptance;
- **ACCP-002** — deterministic best-occurrence selection with review/TSV/Anki parity;
- **ACCP-008** — correct browser fetch binding for real AnkiConnect export;
- **ACCP-009** — stale/deleted Anki note recovery using real AnkiConnect behavior;
- **ACCP-010** — final extension brand/icon asset system;
- **ACCP-015** — UX/export planning baseline and repository implementation order;
- **ACCP-016** — read-only live Anki catalog with real-Anki acceptance and persistent stale metadata;
- **ACCP-019** — source-agnostic staged batch capture, deterministic dedupe/classification, and transactional corpus commit;
- **ACCP-020** — opt-in Duolingo visible lesson backfill with MV3-safe staged/session lifecycle;
- **ACCP-013** — safe multi-deck language routing with pinned export bindings and explicit Anki destination lifecycle;
- **ACCP-017** — bounded read-only deck/model analysis with representative existing-card previews and real-Anki acceptance;
- **ACCP-011** — compact queue, focused review detail, and dedicated Settings navigation shell;
- **ACCP-003** — explicit canonicalization review with rename/consolidation preview and identity-safe consolidation.

---

## Gate A — completed low-coupling groundwork

ACCP-019 now provides the staged candidate/commit boundary required by source-specific backfill work. Source adapters can produce evidence without writing directly to the corpus.

---

## Gate B — completed destination discovery evidence

ACCP-017 is now baseline work alongside ACCP-013 and ACCP-016.

## Gate C — interaction shell and canonical review

### ACCP-011 — sidebar redesign — completed

The compact queue + focused detail/settings shell is now baseline UI.

### ACCP-003 — canonicalization workflow — completed

Canonical/observed review, rename/consolidation preview, and identity-safe consolidation are now baseline behavior.

---

## Gate D — existing Anki models, guided setup, and backfill review

### ACCP-014 — existing note type mapping

Depends on ACCP-013 and completed ACCP-016.

Consumes ACCP-017 representative-card evidence.

### ACCP-018 — guided export-profile setup

Depends on completed ACCP-016, ACCP-017, ACCP-013, ACCP-014, and the ACCP-011 settings shell.

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

Depends on completed ACCP-002 and ACCP-003.

Must preserve review/export parity.

---

## Gate F — optional assistance and learning-value decisions

### ACCP-006 — morphology/canonical-form assistance

Depends on ACCP-003 and ACCP-004.

### ACCP-007 — learning-value decision

Depends on completed ACCP-002, ACCP-004, and ACCP-005.

---

## Recommended linear merge sequence

From the current baseline, when one linear order is needed:

1. ACCP-014 — existing note type mapping
2. ACCP-018 — guided export-profile setup
3. ACCP-021 — batch backfill review/import
4. ACCP-012 — onboarding/user journey
5. ACCP-004 — explicit merge/split
6. ACCP-005 — learning-card policy v2
7. ACCP-006 — morphology assistance
8. ACCP-007 — learning-value decision

ACCP-019, ACCP-020, ACCP-013, ACCP-017, ACCP-011, and ACCP-003 are now baseline work. ACCP-014 is the next linear merge gate and requires real-Anki acceptance before closure.

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
