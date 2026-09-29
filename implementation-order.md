# Implementation order

This file records the current dependency-aware execution state for Anki Cards Collector.

Historical ticket plans under `docs/plans/` remain implementation records. They are not an active backlog.

## Phase 1 feature sequence: COMPLETE

The Phase 1 product-feature sequence is complete.

Completed product work includes:

- lexical-unit / occurrence identity, migrations, explicit canonical review, merge, and split;
- deterministic best-evidence selection, study-content/card policy, optional advisory canonical assistance, and learning-value recommendations;
- compact queue, focused review, onboarding, and explicit Ready authorization;
- local-first generic capture plus opt-in visible-DOM Duolingo staging/backfill;
- staged review/import, durable staged identity, worker reconstruction, and refresh/reclassification recovery;
- live Anki deck/model/note-type discovery and bounded inspection;
- language-aware routing, export profiles, mapped existing user-owned note types, and guided setup;
- idempotent Anki update/recovery with pinned external identity;
- JSON backup/restore, migration coverage, Chromium E2E/accessibility, and Chrome Web Store packaging.

The original motivating flow is implemented:

```text
visible language material
  -> Staged or direct capture
  -> Inbox
  -> deterministic study-content + recommendation
  -> explicit Ready
  -> routed/mapped Anki export
```

Recommendation remains separate from workflow state: it does not imply Ready and does not automatically Archive.

## Release-readiness remediation

- **ACCP-023 — completed.** Reproducible production build, frozen dependency graph, production runtime checks, deterministic ZIP, and UTF-8 ZIP filename handling.
- **ACCP-024 — completed.** Restore commit-boundary consistency and committed-success recovery semantics.
- **ACCP-025 — current / final Phase 1 release gate.** Reconcile public truth, freeze and accept one exact RC, merge that exact tree, create the first versioned release, publish the exact artifact to the Chrome Web Store, and expose the durable normal-user install path.

ACCP-025 must not claim completion before the Chrome Web Store listing is actually installable.

## Current ACCP-025 order

```text
Tranche A
  public docs/assets truth
  -> exact RC build/package evidence
  -> bounded real RC acceptance
  -> independent full-snapshot review
  -> master merge decision

Tranche B
  exact reviewed tree becomes canonical main
  -> tag v0.1.0
  -> GitHub Release ZIP + checksum
  -> verify artifact identity
  -> Chrome Web Store publication
  -> publish real install URL
  -> close/supersede stale PR #68
  -> close issue #80
```

No tag, GitHub Release, or Chrome Web Store submission should be created from an unmerged implementation branch.

## After ACCP-025

Phase 1 is closed.

A first explicit Phase 2 integration boundary is now admitted:

### ACCP-026 — Optional Qanbee Linguist connector — BLOCKED UNTIL RELEASE + CONTRACT

ADR: `docs/decisions/0013-optional-qanbee-linguist-connector.md`  
Plan: `docs/plans/ACCP-026-qanbee-linguist-connector.md`

Start only after:

```text
ACCP-025 Chrome Web Store install path complete
  -> qanbee-linguist owning repository exists
  -> Linguist ingestion contract v1 frozen/reviewed
  -> connector privacy/auth UX specified
  -> ACCP-026 implementation
```

ACCP-026 is optional integration work, not a continuation of the Phase 1 release gate. Collector must remain fully useful without Qanbee, remote accounts, subscription, telemetry or QLI.

Do not silently revive completed Phase 1 tickets as active planned work.

## Quality gates

Repository changes preserve:

```bash
npm run check
```

UI changes keep Chromium E2E and accessibility checks green.

Storage/backup changes require deterministic migration/restore coverage. Anki discovery/routing/model work requires real-Anki acceptance in addition to mocks. Source-session work requires browser-level privacy/permission coverage.

No change may silently:

- duplicate study material;
- move an exported card to a different deck;
- mutate a user-owned Anki model;
- infer a target model solely from deck popularity;
- turn staged source candidates directly into Ready cards;
- rewrite lexical identity from an unapproved suggestion.


## Phase 2 invariant

```text
Collector local corpus / review / Anki export = standalone product truth
Collector -> Linguist = optional explicit connector
Collector -> QLI = forbidden direct dependency
```

The Phase 2 connector must never become a reason to delay or weaken the public Phase 1 release.
