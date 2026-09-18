# Roadmap

The important distinction here is between finishing Phase 1 well and quietly turning it into Phase 2.

## Phase 1 hardening

These changes make the existing local-first product better without changing what it is:

- edit expression, language, context, and note before export;
- restore a JSON backup, not only create one;
- sanitise source URLs by default;
- browser-level integration tests for capture and side-panel messaging;
- keyboard-first review flow;
- accessibility audit;
- export progress / per-item error reporting;
- extension icons, screenshots, release packaging, and signed store build;
- migration tests as the IndexedDB schema evolves.

## Phase 2 candidates

These require a fresh product decision rather than being slipped into the extension:

- account and cross-device sync;
- mobile/share-sheet capture;
- server-side linguistic enrichment;
- translation, lemma, morphology, and usage ranking;
- richer media capture;
- spaced-repetition systems beyond Anki;
- shared collections or teacher workflows;
- paid plans.

A backend belongs here only when one of those requirements is real.

## Explicit non-goals

- background scraping of browsing activity;
- private API reverse engineering;
- credential/token collection;
- automated completion of learning-platform exercises;
- making the public product depend on Duolingo markup.

Those constraints are part of the architecture, not temporary missing features.
