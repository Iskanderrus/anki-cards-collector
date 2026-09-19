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

The next work focuses on daily usability, safe multilingual routing, compatibility with existing Anki setups, and better evidence-driven learning proposals.

### Product and UX

- ACCP-010 — adopt the final icon/brand asset system;
- ACCP-011 — replace the repeated full-card sidebar with a compact queue and focused detail view;
- ACCP-012 — improve first-run onboarding and the capture/review/export journey.

See:

- [brand assets](design/brand-assets.md)
- [sidebar UX audit](design/sidebar-ux-audit.md)
- [user journey](product/user-journey.md)

### Anki integration

- ACCP-013 — export profiles and language-aware multi-deck routing;
- ACCP-014 — existing note type integration through explicit field mapping without mutating user-owned models.

See:

- [Anki export strategy](product/anki-export-strategy.md)
- [ADR 0008](decisions/0008-export-profiles-and-routing.md)
- [ADR 0009](decisions/0009-user-owned-anki-models.md)

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
- silent cross-deck moves caused by changing a default route.
