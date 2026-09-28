# Chrome Web Store listing copy

This file is dashboard-ready copy for the functionality implemented in the Phase 1 release candidate. Keep it synchronized with the exact extension submitted to the Store.

## Short description

Collect words and phrases from the web, review them locally, then send the useful ones to Anki.

## Detailed description

Anki Cards Collector keeps useful language close to the page where you found it.

Select a word, phrase, or sentence on a web page and collect it into a local review inbox. Collector keeps visible surrounding context, separates the canonical learning target from the form actually observed on the page, deduplicates repeated evidence while preserving separate occurrences, and lets you edit the canonical form, observed form, language, context, and learner note before export.

A deterministic local policy proposes bounded study content from accepted evidence. Collector also provides deterministic **Study / Improve / Evidence only / Archive for now** guidance. These recommendations are advisory: they do not mark an item Ready and do not automatically Archive it.

Ready items can be sent to Anki through AnkiConnect running on localhost. Multiple languages can route to different configured profiles/decks. Existing user-owned note types can be used through explicit field mapping; Collector writes mapped fields only and does not rewrite the user's field schema, templates, or CSS.

Collector IDs and export bindings make export idempotent: an item that was already exported is updated instead of blindly creating another note. Deleted/stale Anki note identity can be recovered through the normal explicit export/retry path.

The local corpus can also be exported as TSV or backed up/restored as versioned JSON.

Key properties:

- explicit user-triggered capture rather than background scraping;
- local IndexedDB storage with no account, application server, analytics, or telemetry;
- generic web capture plus an optional explicit visible-DOM Duolingo adapter;
- Inbox / Ready / Archived review states;
- Staged evidence review before corpus import;
- canonical lexical units with occurrence-level observed surface forms;
- deterministic local study-content and learning-value policy;
- optional advisory canonical-form assistance with explicit acceptance;
- multilingual Anki routing and guided mapped-profile setup;
- privacy-filtered source URLs;
- validated JSON backup v4 restore;
- accessibility regression checks in Chromium;
- direct AnkiConnect export with portable TSV fallback.

The extension does not read cookies, credentials, authentication tokens, browser history, or private learning-platform APIs. It does not continuously monitor browsing activity.

## Permission rationale

### activeTab

Provides temporary page access after an explicit user action so selected text and nearby visible context can be captured.

### scripting

Injects the capture script on demand into the active page. Collector does not install a persistent all-sites content script.

### contextMenus

Adds the **Collect for Anki** action to the browser selection context menu.

### sidePanel

Hosts capture controls, review/editing, staged review, Anki setup, backup/restore, settings, and export.

### storage

Stores extension settings locally and supports transient MV3 session reconstruction for explicit staged/backfill workflows.

### localhost host permissions

`http://127.0.0.1:8765/*` and `http://localhost:8765/*` are used only for explicit user-triggered communication with local AnkiConnect.

That includes connection/catalog refresh, deck/model/note-type inspection, guided setup/revalidation, bounded representative-card inspection where applicable, and export/update/recovery. Collector does not continuously poll Anki.

### optional Duolingo host permissions

`https://duolingo.com/*` and `https://*.duolingo.com/*` are optional. They support only explicit visible-DOM scan/session capture. Granting permission alone does not start collection.

## Privacy summary

Collected expressions, contexts, review state, retained source metadata, and Anki identity remain in browser-local storage unless the user explicitly exports or creates a backup.

Backup v4 preserves the durable study corpus, export bindings, and Collector settings. Transient Staged/session state, onboarding presentation state, and in-memory UI/review-session state are not guaranteed by the backup.

Collector has no application server, telemetry, remote morphology provider, continuous browsing surveillance, or private Duolingo API/network interception.

See `docs/privacy.md` for the complete privacy boundary.
