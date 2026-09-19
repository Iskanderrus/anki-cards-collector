# Engineering roadmap

The current extension has a tested local-first capture -> review -> Anki export foundation.

Implemented hardening includes:

- canonical lexical units with preserved observed occurrences;
- deterministic learning-card proposals;
- idempotent Anki updates and stale-note recovery;
- JSON backup/restore and IndexedDB migration coverage;
- source-URL privacy controls;
- browser E2E and accessibility checks;
- validated Chrome Web Store packaging;
- real v1 -> v2 migration acceptance against a browser profile and Anki collection.

## Active planned work

The next work focuses on daily usability, safe multilingual routing, live Anki discovery, compatibility with existing Anki setups, source backfill, and better evidence-driven learning proposals.

### Product and UX

- ACCP-010 — final icon/brand asset system;
- ACCP-011 — compact queue and focused detail sidebar;
- ACCP-012 — first-run onboarding and capture/review/export journey;
- ACCP-018 — guided export-profile setup from live Anki metadata;
- ACCP-021 — staged backfill review/import workflow.

### Anki integration

- ACCP-016 — read-only live catalog of decks, models, fields, templates, and styling;
- ACCP-017 — bounded deck/model usage analysis and representative existing-card preview;
- ACCP-013 — export profiles and language-aware multi-deck routing;
- ACCP-014 — existing note type integration through explicit field mapping without mutating user-owned models.

### Capture and source backfill

- ACCP-019 — generic staged batch-capture pipeline;
- ACCP-020 — opt-in Duolingo visible lesson/review backfill;
- ACCP-021 — review/select/commit staged candidates before normal card review.

See:

- [Duolingo visible-material backfill](product/duolingo-backfill.md)
- [ADR 0002](decisions/0002-source-adapters.md)
- [ADR 0011](decisions/0011-staged-source-backfill.md)

### Learning/corpus work

- ACCP-002 — deterministic best-occurrence selection;
- ACCP-003 — explicit canonicalization workflow;
- ACCP-004 — merge/split semantics;
- ACCP-005 — learning-card policy v2;
- ACCP-006 — optional morphology/canonical-form assistance;
- ACCP-007 — learning-value decision.

Detailed plans live in [docs/plans](plans/README.md).

The dependency-aware merge order is maintained in [implementation-order.md](../implementation-order.md).

## External release step

Store submission remains operational work:

- upload the validated ZIP and listing assets to the Chrome Web Store Developer Dashboard;
- complete Store listing and Privacy information;
- resolve store validation findings;
- submit for review.

Store screenshots should be refreshed after the sidebar/brand work to avoid publishing obsolete UI.

See [release checklist](release.md).

## Explicit non-goals

- background scraping of browsing activity;
- private API reverse engineering;
- credential or token collection;
- automated completion of learning-platform exercises;
- silent mutation of user-owned Anki note types;
- silent cross-deck moves caused by changing a default route;
- silently choosing a target note type from deck popularity.
