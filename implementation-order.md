# Implementation order

This file is the dependency-aware execution order for current Collector work.

It is intentionally stricter than issue-number order. Some work can run in parallel; later work should not be built on UI/data assumptions that are about to be replaced.

## Completed foundation

The following work is already part of the current baseline:

- **ACCP-001** — canonical lexical units vs observed forms, including real v1 -> v2 migration acceptance;
- **ACCP-008** — correct browser fetch binding for real AnkiConnect export;
- **ACCP-009** — stale/deleted Anki note recovery using real AnkiConnect behavior.

These are prerequisites, not active work.

---

## Gate A — visual identity and export correctness

### ACCP-010 — brand assets

Can merge independently.

Why early:

- low dependency;
- removes placeholder identity;
- lets later screenshots/store assets use the real mark.

Do not block architecture work on it.

### ACCP-013 — export profiles and multi-deck routing

This is the first major correctness boundary.

It replaces the unsafe assumption that one global deck/model applies to every Ready item.

Must land before the final sidebar redesign because the new UI needs a stable destination/profile concept.

Manual acceptance should include at least two languages routed to two real Anki decks in one Ready batch.

### ACCP-002 — best occurrence selection

Can run in parallel with ACCP-013.

It is primarily domain logic and should stay independent from React/Anki.

It must land before ACCP-003/005 so later review/card-policy work consumes the same selected evidence.

---

## Gate B — interaction shell

### ACCP-011 — sidebar redesign

Depends on ACCP-013's export-profile model.

Consumes ACCP-002 selected-occurrence information when available.

This creates the compact queue + focused detail structure that later review features should target.

Do not implement ACCP-003's final UI on the old repeated-card surface.

Required acceptance fixtures:

- at least 20 queued items;
- 10+ word canonical target;
- several occurrences;
- mixed destinations;
- keyboard-only review;
- axe A/AA checks.

### ACCP-003 — canonicalization workflow

Implement in the ACCP-011 detail view.

Depends on ACCP-002 for evidence selection and on the new interaction shell for final UX.

This must land before explicit merge/split and morphology assistance.

---

## Gate C — daily workflow and Anki compatibility

Two items can proceed mostly in parallel once ACCP-011/013 are stable.

### ACCP-012 — onboarding and user journey

Depends on ACCP-011 and ACCP-013.

It should explain the real profile/routing workflow rather than teaching temporary global-deck behavior.

Browser acceptance covers first run -> capture -> review -> mixed-destination export.

### ACCP-014 — existing Anki note types and field mapping

Depends on ACCP-013.

Benefits from ACCP-011 because profile configuration needs a usable settings surface.

Manual acceptance should use a non-Collector Anki note type and prove:

- its fields/templates/CSS are not mutated;
- mapped fields receive the expected values;
- note identity remains idempotent;
- stale-note recovery still works.

---

## Gate D — corpus operations and card quality

### ACCP-004 — explicit merge and split

Depends on ACCP-003.

Stabilizes identity semantics for homographs/senses before language assistance starts.

Requires IndexedDB/backup migration coverage if the uniqueness/index model changes.

### ACCP-005 — learning-card policy v2

Depends on ACCP-002 and ACCP-003.

Can be developed in parallel with late ACCP-004 work if it does not assume canonical-text uniqueness.

Must preserve review/export parity.

---

## Gate E — optional assistance and learning-value decisions

### ACCP-006 — morphology/canonical-form assistance

Depends on ACCP-003 and ACCP-004.

Do not start provider-specific implementation before the manual canonicalization and split/merge boundaries are stable.

Assistance remains optional and user-approved.

### ACCP-007 — learning-value decision

Depends on ACCP-002, ACCP-004, and ACCP-005.

This is intentionally last among current learning-policy work because it combines identity, evidence quality, and proposal quality.

---

## Recommended merge sequence

When a single linear order is needed, use:

1. ACCP-010 — brand assets
2. ACCP-013 — export profiles / multi-deck routing
3. ACCP-002 — best occurrence selection
4. ACCP-011 — sidebar redesign
5. ACCP-003 — canonicalization workflow
6. ACCP-012 — onboarding/user journey
7. ACCP-014 — existing note type mapping
8. ACCP-004 — explicit merge/split
9. ACCP-005 — learning-card policy v2
10. ACCP-006 — morphology assistance
11. ACCP-007 — learning-value decision

ACCP-013 and ACCP-002 are intentionally safe to develop in parallel. ACCP-012 and ACCP-014 can also overlap once their shared UI/profile dependencies are stable.

---

## Quality gates for every item

Every implementation PR should preserve the repository's existing baseline:

```bash
npm run check
```

Changes that affect the extension UI must also keep Chromium E2E and accessibility checks green.

Changes that affect storage or backup semantics need:

- a frozen migration fixture;
- deterministic backup migration/validation;
- round-trip tests.

Changes that affect Anki routing, identity, model ownership, or recovery need a real-Anki manual acceptance run in addition to mocks.

No item should silently:

- duplicate study material;
- move an exported card to a different deck;
- mutate a user-owned Anki model;
- rewrite lexical identity from an unapproved suggestion.
