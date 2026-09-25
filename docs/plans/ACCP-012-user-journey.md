# ACCP-012: User journey and onboarding

## Goal

Make capture -> review -> export understandable and comfortable without repository knowledge.

## Dependencies

Implemented on the stable baseline provided by:

- ACCP-011 compact queue/detail/Settings shell;
- ACCP-013 language routing and pinned per-item destinations;
- ACCP-014 mapped-only existing-note-type writes;
- ACCP-016/017 live Anki discovery and representative inspection;
- ACCP-018 guided profile setup and revalidation;
- ACCP-021 staged selected-only import;
- ACCP-022 explicit staged refresh/reclassification recovery.

## Implemented experience

### First run

A four-step skippable introduction covers:

- collect selected text;
- local Inbox;
- explicit Ready state;
- multilingual Anki profiles;
- Anki Desktop + AnkiConnect;
- explicit Staged/backfill behavior;
- local-first/privacy boundary.

Completion/skip uses one small `chrome.storage.local` preference outside the corpus/settings schema. The introduction can be reopened from Settings without destructive setup.

### Capture feedback

The existing capture boundary now returns a minimal confirmation classification:

- new Inbox item;
- additional occurrence on an existing item.

Capture stays in reading flow and does not force detail/edit mode.

### Review session

**Review Inbox** takes a snapshot of current Inbox IDs and presents them sequentially through the existing detail UI.

- Ready/Archive advances to the next Inbox item.
- Viewing alone never changes state.
- Exit returns to the normal Inbox shell.
- Existing keyboard shortcuts are reused.
- No persisted review-session state or new domain status was added.

### Export confidence

A pre-export dialog uses `resolveExportRoute` plus the existing profile validation boundary to display the real destination groups and blocked items.

Export remains per-item isolated through the existing batch engine. Progress includes completed/total and current resolved profile/deck when known.

Results distinguish success, committed-success/local-link warning, and failure. Known failures are translated into a next user action while raw detail remains expandable.

### Anki unavailable

Capture, Inbox, Staged, profiles, and local corpus remain available when Anki is closed. Settings/export recovery copy explains how to restore the connection without implying material was lost.

### Settings and privacy

Settings exposes normal task groupings before rare controls, preserves guided profile setup/revalidation and backup/restore, and provides a **View introduction** action.

Privacy copy states that captures are local, continuous background browsing collection does not occur, Duolingo scanning is explicit, and direct export uses local AnkiConnect.

## Browser acceptance

The main Chromium journey covers:

- fresh state -> onboarding -> skip -> no unexpected reappearance -> reopen/finish from Settings;
- selected capture -> lightweight Inbox confirmation -> no forced detail;
- repeated capture -> occurrence confirmation;
- multiple Inbox items -> sequential review -> Ready advances -> Archive completes;
- mixed Ready destinations -> preview grouped routes -> export;
- Anki unavailable -> actionable export failure -> corpus/settings preserved;
- Staged -> selected import -> Inbox, never Ready;
- keyboard-only review semantics and no shortcut hijack while typing;
- axe checks including first-run onboarding plus the existing relevant UI journeys.

## Persistence decision

No database/schema migration is required. Onboarding state is a backwards-compatible extension preference and does not participate in corpus backup/restore.

## Deliberately deferred

ACCP-012 does not implement:

- ACCP-004 merge/split;
- ACCP-005 learning-card policy v2;
- ACCP-006 morphology assistance;
- ACCP-007 learning-value decisions;
- remote/cloud services, accounts, or analytics.
