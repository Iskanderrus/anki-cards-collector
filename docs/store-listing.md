# Chrome Web Store listing copy

This file is a dashboard-ready description of the functionality implemented in this repository. Keep it synchronized with the extension before each submission.

## Short description

Collect words and phrases from the web, review them locally, then send the useful ones to Anki.

## Detailed description

Anki Cards Collector keeps useful language close to the page where you found it.

Select a word, phrase, or sentence on a web page and collect it into a local review inbox. The extension keeps visible surrounding context, separates the canonical learning target from the form actually observed on the page, deduplicates repeated lexical items while preserving separate occurrences, and lets you edit the canonical form, observed form, language, context, and learner note before export. A deterministic local policy then proposes one bounded study card from the captured evidence and explains why that proposal was chosen.

Ready items can be sent to Anki through AnkiConnect running on localhost. Collector IDs make export idempotent: an item that was already exported is updated instead of blindly creating another note. Batch export reports progress and isolates per-item failures so one rejected card does not stop the rest.

The local corpus can also be exported as TSV or backed up and restored as versioned JSON.

Key properties:

- explicit user-triggered capture rather than background scraping;
- local IndexedDB storage with no account or application server;
- generic web capture plus an optional visible-DOM Duolingo adapter;
- inbox / ready / archived review states;
- canonical lexical units with occurrence-level observed surface forms;
- local word/chunk/sentence classification and reviewable card proposals;
- contextual production prompts when the captured evidence supports them;
- no generated translations or invented semantic claims;
- keyboard-first review;
- privacy-filtered source URLs;
- validated JSON backup restore;
- accessibility regression checks in Chromium;
- direct AnkiConnect export with portable TSV fallback.

The extension does not read cookies, credentials, authentication tokens, browser history, or hidden learning-platform APIs. It does not continuously monitor browsing activity.

## Permission rationale

### activeTab

Provides temporary page access after an explicit user action so the selected text and nearby visible context can be captured.

### scripting

Injects the capture script on demand into the active page. The extension does not install a persistent all-sites content script.

### contextMenus

Adds the **Collect for Anki** action to the browser selection context menu.

### sidePanel

Hosts the review, editing, backup, settings, and export interface.

### storage

Stores extension settings locally in the browser.

### localhost host permissions

`http://127.0.0.1:8765/*` and `http://localhost:8765/*` are used only for user-triggered communication with AnkiConnect.

## Privacy summary

Collected expressions, contexts, review state, source metadata, and Anki note IDs remain in browser-local storage unless the user explicitly exports or backs them up.

See `docs/privacy.md` for the repository's complete privacy boundary.
