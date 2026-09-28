# Privacy boundary

The short version: Collector is local-first, explicit-action-driven, and designed so there is very little remote infrastructure to trust.

## Data that stays local

The durable corpus lives in extension IndexedDB and includes lexical units, occurrences, review state, learner notes, retained source metadata, Anki note identity, and export bindings.

Collector settings live in `chrome.storage.local`. They include source-URL retention, export profiles, language routes, and fallback/default configuration.

Transient Staged/backfill reconstruction state and live-session ownership are mirrored in `chrome.storage.session` so an MV3 worker restart does not immediately lose the active browser-session workflow. That state is transient and is not part of the durable corpus or JSON backup guarantee.

The extension has no application server, analytics SDK, telemetry endpoint, or account system.

## Page access

The manifest does not install a persistent content script across every site.

Ordinary capture uses `activeTab` and `chrome.scripting` after an explicit user action. The injected script reads the current selection plus nearby visible text for context.

Collector does not intentionally read:

- cookies;
- local/session storage belonging to the page;
- passwords or form credentials;
- authentication tokens;
- page network traffic;
- browser history;
- hidden Duolingo APIs.

Generic capture remains the fallback path.

## Local AnkiConnect access

The only required host permissions are the local AnkiConnect endpoints:

- `http://127.0.0.1:8765/*`
- `http://localhost:8765/*`

AnkiConnect access is local and user-triggered, but it is **not export-only**. Explicit operations include:

- connection/catalog refresh;
- deck/model/note-type inspection;
- guided export-profile setup;
- profile revalidation;
- bounded representative existing-card inspection where applicable;
- export/update/move/recovery operations.

Collector does not continuously poll Anki.

## Duolingo permission and capture

Duolingo origins are optional host permissions. Granting the permission does not itself start collection.

A one-shot scan or explicit backfill session reads only visible study DOM. Collector does not use a private Duolingo API, intercept network requests, collect authentication tokens, or automate lesson answers/submission/advancement.

## Canonical-form assistance

Production canonical-form assistance is local and advisory. Collector has no remote morphology provider or added network permission for this feature. Provider output is ephemeral and changes lexical identity only after explicit user acceptance.

## Source URL retention

A source URL can be useful study context, but URLs can also contain credentials, private identifiers, query parameters, fragments, and tracking data.

The default retention mode stores only origin + path. Query parameters and fragments are removed.

Settings expose two explicit alternatives:

- retain non-tracking query parameters when they are useful study context;
- do not store the source URL at all.

Credentials and fragments are never retained. Known tracking parameters such as `utm_*`, `gclid`, `fbclid`, and similar identifiers are removed even when useful query parameters are enabled.

This policy runs before a capture is written to IndexedDB, so later backups/exports inherit the retained value rather than receiving the raw page URL.

## JSON backup v4 boundary

Backup and restore are local browser operations. A selected restore file is parsed, validated, previewed, and merged inside the extension; it is not uploaded to a Collector service.

Backup v4 preserves:

- lexical units and their stable Collector IDs;
- occurrences and occurrence IDs;
- canonical/observed text, contexts, retained source metadata, and capture timestamps;
- review states and learner notes;
- export bindings and Anki identity snapshots;
- Collector settings, including export profiles, language routes, fallback configuration, and source-retention settings.

Backup v4 does **not** promise to preserve browser-session/UI state such as:

- current Staged/backfill session state;
- live Duolingo session ownership;
- onboarding/introduction presentation state;
- current in-memory review-session/navigation state.

The backup is therefore durable study/configuration recovery, not a byte-for-byte browser-profile snapshot. See [backup and restore](backup-and-restore.md).

## Restore committed-success boundary

Restore has an explicit durable-success boundary.

If repository restore fails before commit, preparatory settings changes may be compensated.

If corpus/settings restore has already committed and a later UI refresh fails:

- restored data/settings remain durable;
- the restore is not rolled back;
- the user should reload the extension UI to recover the presentation layer.

A post-commit refresh problem must not be described as “nothing changed”.

## Public repository vs personal data

The repository contains code, synthetic examples, architecture notes, tests, and synthetic public/store evidence. It must not contain a real personal corpus, exported browser data, Anki backups, or private study material.
