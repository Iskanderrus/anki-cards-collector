# Backup and restore

Collector's JSON backup is a durable study/configuration backup, not a byte-for-byte browser profile snapshot.

## Current format

Current backup format: **v4**.

The v4 document contains:

- `items` — collected lexical units plus their occurrences;
- `exportBindings` — per-lexical-unit Anki destination/identity bindings;
- `settings` — Collector settings;
- `exportedAt` — backup creation timestamp.

Versions 1-3 remain importable through the current migration/validation path.

## What v4 preserves

### Lexical units

The backup preserves durable lexical-unit data including:

- stable lexical-unit / Collector ID;
- canonical text and normalized identity data;
- language;
- learner note;
- Inbox / Ready / Archived state;
- timestamps;
- legacy/current Anki note identity where represented by the persisted model.

Same-language/same-canonical units may remain separate identities. Restore matches durable identity by IDs rather than auto-merging equal canonical text.

### Occurrences

Occurrences preserve:

- stable occurrence ID;
- lexical-unit ownership;
- observed surface text;
- context;
- retained source metadata;
- capture timestamp.

### Export bindings

Bindings preserve:

- lexical-unit ID;
- export profile ID;
- binding lifecycle state (`override`, `reserved`, or `exported`);
- Anki note ID when present;
- pinned deck/model identity snapshots when present;
- binding update timestamp.

### Settings

Backup v4 includes Collector settings such as:

- default/capture language configuration where applicable;
- source-URL retention mode;
- export profiles;
- language routes;
- fallback export profile.

That lets restore recover the routing/profile configuration referenced by exported bindings.

## What v4 does not guarantee

The current backup does not serialize transient browser-session presentation/runtime state, including:

- current Staged/backfill reconstruction/session state;
- live Duolingo session ownership;
- onboarding/introduction presentation state;
- current in-memory review-session/navigation state;
- ephemeral derived learning-value recommendations;
- ephemeral canonical-assistance provider output.

Those states can be recreated or recomputed from durable state where the product supports it, but they are outside the backup contract.

A Collector JSON backup is also not an Anki collection backup. Existing Anki notes remain owned by Anki; Collector preserves the local identity/binding information used to reconcile with them.

## Restore workflow

Restore is explicit and local:

1. choose a JSON backup;
2. parse and validate format/schema/invariants;
3. preview the merge;
4. confirm;
5. apply the repository/settings restore;
6. refresh the UI from committed durable state.

Unknown/newer unsupported versions fail closed.

## Durable-success boundary

Repository restore success is the irreversible durable-success boundary.

Before that boundary, a failure may compensate preparatory settings changes.

After that boundary, a later refresh failure is **not** a failed restore:

- restored corpus/settings remain durable;
- compensation/rollback is forbidden;
- the UI should tell the user that restore committed but refresh failed;
- reload the extension UI to recover the presentation layer.

Do not retry a destructive restore merely because the post-commit UI refresh failed.

## Privacy

Backup creation and restore are local browser operations. Collector does not upload the JSON backup to an application server.

Source metadata inside the backup has already passed the configured source-URL retention policy before entering the corpus.
