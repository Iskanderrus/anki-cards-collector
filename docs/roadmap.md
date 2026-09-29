# Engineering roadmap

The Phase 1 product-feature roadmap is complete. This document describes the actual current product state rather than presenting merged tickets as future work.

## Completed Phase 1

### Capture and corpus identity

- explicit selection capture from ordinary pages;
- canonical lexical units separated from observed occurrences;
- stable lexical IDs with explicit canonical edit, merge, and split;
- deterministic duplicate/ambiguity handling;
- local IndexedDB persistence and tested schema migrations.

### Review and learning policy

- compact Inbox/focused-review UI and first-run onboarding;
- deterministic best-evidence selection;
- deterministic study-content/card policy;
- optional advisory canonical-form assistance;
- deterministic **Study / Improve / Evidence only / Archive for now** recommendation;
- explicit Ready authorization independent from recommendation.

### Staged / Duolingo flow

- source-agnostic staged capture;
- opt-in visible-DOM Duolingo scan/session;
- selected-only staged import into Inbox;
- durable staged identity across MV3 worker recreation;
- explicit refresh/reclassification and stale-snapshot recovery;
- no Staged -> Ready or Staged -> Anki shortcut.

### Anki integration

- localhost AnkiConnect client;
- live deck/model/note-type discovery;
- bounded read-only representative-card inspection;
- multilingual export profiles and language routing;
- explicit mapped existing user-owned note types;
- guided setup/revalidation;
- idempotent export/update, stale-note recovery, and pinned external identity;
- protection of user-owned field schema, templates, and CSS.

### Reliability, privacy, and release engineering

- source-URL privacy controls;
- JSON backup v4 + validated restore;
- restore committed-success boundary;
- browser E2E and accessibility checks;
- reproducible production dependency graph;
- deterministic Chrome Web Store ZIP/checksum;
- production-runtime and package-boundary validation.

Detailed historical plans remain under [docs/plans](plans/README.md). They are records of completed work, not an active Phase 1 backlog.

## Current release/distribution gate

**ACCP-025 / issue #80 is the final Phase 1 gate.**

Repository-side Tranche A:

- reconcile README/status/privacy/backup/release truth;
- keep a current synthetic production-UI screenshot;
- freeze one exact release-candidate head;
- rerun reproducible package checks and inspect the actual ZIP;
- perform bounded real acceptance with Anki Desktop + AnkiConnect and visible-DOM Duolingo where externally available;
- hand the exact `BASE -> HEAD` snapshot to independent review.

Post-merge Tranche B:

- make the independently accepted tree canonical `main`;
- tag the first release as `v0.1.0` while package/manifest remain `0.1.0`;
- let the Release workflow create the exact ZIP + checksum;
- verify that release artifact against the accepted candidate;
- submit that exact ZIP to the Chrome Web Store;
- expose the real public install URL in README;
- close/supersede stale PR #68;
- close issue #80 only after the Store listing is actually installable.

Until publication, the truthful public status is **Phase 1 release candidate; Chrome Web Store publication pending final accepted RC**.

See [release checklist](release.md).

## Future work requires an explicit Phase 2 decision

Phase 1 does not imply an automatic paid/commercial roadmap. Any future product work must start from a new explicit roadmap/Phase 2 decision rather than being presented here as already planned.

Possible future decisions may be documented only when they are actually authorized; this file intentionally does not manufacture a backlog.

## Explicit non-goals of the current product

- background scraping of browsing activity;
- private API reverse engineering;
- credential/token collection;
- automated completion of learning-platform exercises;
- silent mutation of user-owned Anki note types;
- silent cross-deck moves caused by changing a default route;
- silently choosing a target note type from deck popularity;
- automatic promotion to Ready or automatic Archive from a recommendation;
- cloud sync/account/server requirements for the Phase 1 study workflow.
