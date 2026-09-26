# ACCP-005: Learning-card policy v2

## Status

Implemented on the ACCP-005 branch; final merge remains gated by exact-head verification and independent full-snapshot review.

## Goal

Refine deterministic learning-card proposals around ACCP-002 occurrence quality while preserving one-card budget, explicit learner evidence, ACCP-004 identity semantics, and exact review/export study-content parity.

## Dependencies

Completed baseline:

- ACCP-002 — deterministic best-occurrence selection;
- ACCP-003 — canonicalization workflow;
- ACCP-004 — explicit merge/split identity semantics;
- ACCP-011/012 — focused review and export-preview shell;
- ACCP-013/014 — export routing and user-owned model mapping.

## Phase 0 findings

Before implementation:

- review, export preview, TSV, Anki mapping/client all called the same pure proposal function, but recomputed it independently;
- merge/split identity previews called the lower-level occurrence selector directly and could use different selection options;
- ordinary edit invalidated Ready on any lexical/occurrence edit;
- capture, merge, and split broadly forced Inbox even when exported study content was unchanged;
- backup restore could mutate evidence on an existing Ready identity without a study-content reconciliation step;
- proposals were already derived state and `LexicalUnit.id` already remained the export identity, so no schema migration or ADR change was needed.

## Implemented policy boundary

`deriveLearningStudyContent()` is authoritative for:

- selected occurrence;
- card decision;
- Prompt/Answer/CardKind/Why;
- Canonical/Observed/Context/Note/Source.

No automatic translation, definition, morphology generation, LLM/API semantics, multiple-card generation, or opaque scoring was added.

## Deterministic decisions

### Word

- learner note -> recognition with learner-supplied answer;
- useful clean context without note -> recognition with context explicitly labelled as evidence;
- weak/noisy/no context without note -> non-recommended with remediation.

### Chunk/construction

- strong usable selected context -> contextual production;
- selected observed surface is blanked;
- answer preserves observed form, canonical form when different, and learner note when supplied;
- weak context + note -> recognition fallback;
- weak context without note -> non-recommended.

### Sentence

- contextual recall requires a bounded target: at most 12 target words, selected surface present, context on both sides, at least 4 residual words, bounded/noise-free context;
- learner note permits conservative sentence review when contextual recall is unavailable;
- otherwise non-recommended with a concrete narrowing/note action.

Overly broad targets (>25 words or >180 characters) remain non-recommended.

## Ready invalidation

A central study-content signature compares effective content before/after repository mutations.

Covered mutation paths:

- repeated capture / stronger evidence;
- learner-note edit;
- canonical edit;
- selected observed/context edit;
- explicit merge;
- explicit split;
- backup restore.

A changed signature returns Ready to Inbox. Equivalent evidence that leaves exported semantic values unchanged preserves Ready.

New split identities always start Inbox.

## Review/export parity

The same derivation drives:

- focused side-panel review;
- export preview;
- TSV;
- Collector-managed Anki fields;
- mapped user-owned Anki fields.

Export preview snapshots the study-content signature and visible semantic fields. Export fails closed if previewed content changes before execution.

A dedicated parity test uses canonical != observed and compares review derivation, preview payload, TSV serialization, and actual Anki `addNote` fields.

## UI

The existing detail UI was extended, not redesigned.

It exposes:

- selected occurrence even when there is only one;
- selected surface/context;
- deterministic occurrence-selection explanation;
- proposed Prompt/Answer and card kind;
- actionable rejection warning.

Export preview now exposes the reviewed study content before the write.

## Verification coverage

Policy tests cover:

1. isolated word + learner note;
2. isolated word without learner note;
3. word with strong context;
4. word with weak/noisy context;
5. strong chunk -> contextual production;
6. weak chunk -> no silent production;
7. canonical != observed;
8. sentence with bounded retrieval target;
9. sentence without bounded retrieval target;
10. overly broad target;
11. stronger older occurrence over weaker newer;
12. deterministic equal-quality tie-break;
13. newly stronger evidence changing study signature.

Repository tests cover:

- stronger capture invalidation;
- note/canonical/observed/context invalidation;
- equivalent evidence preserving Ready;
- merge/split content-sensitive behavior;
- restore reconciliation.

Browser E2E covers:

- selected-occurrence explanation;
- equivalent recapture preserving Ready;
- stronger evidence invalidating Ready;
- weak chunk fail-closed;
- sentence without target fail-closed;
- reviewed study payload in export preview;
- existing Chromium accessibility path.

## Non-goals preserved

- no ACCP-006 morphology assistance;
- no ACCP-007 learning-value classifier;
- no generated semantics;
- no persisted proposal;
- no Anki template/CSS/model mutation changes;
- no routing changes;
- no weakening of ACCP-004 identity guarantees.
