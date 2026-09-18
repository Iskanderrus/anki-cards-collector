# Privacy boundary

The short version: the extension is designed so there is very little to trust.

## Data that stays local

Collected expressions, contexts, source URLs, review states, and Anki note IDs live in the extension's IndexedDB storage.

Settings live in `chrome.storage.local`.

The extension has no application server, analytics SDK, telemetry endpoint, or account system.

JSON backup and restore are local operations. A backup file is created in the browser, and a selected restore file is parsed, validated, previewed, and merged inside the extension. It is not uploaded anywhere.

## Page access

The manifest does not install a persistent content script across every site.

Capture uses `activeTab` and `chrome.scripting` after an explicit user action. The injected script reads the current selection plus nearby visible text for context.

It does not intentionally read:

- cookies;
- local/session storage;
- passwords or form credentials;
- authentication tokens;
- page network traffic;
- browser history;
- hidden Duolingo APIs.

The Duolingo adapter is DOM-only and optional. Generic capture is the fallback path.

## Network access

The only declared host permission is AnkiConnect on localhost:

- `http://127.0.0.1:8765/*`
- `http://localhost:8765/*`

That connection is used only when the user starts an Anki export.

## Source URL retention

A source URL is useful study context, but URLs can contain credentials, private identifiers, query parameters, fragments, and tracking data.

The default retention mode stores only the URL origin and path. Query parameters and fragments are removed.

The settings panel exposes two explicit alternatives:

- keep non-tracking query parameters when they are genuinely useful study context;
- do not store the source URL at all.

Credentials and fragments are never retained. Known tracking parameters such as `utm_*`, `gclid`, `fbclid`, and similar identifiers are removed even when useful query parameters are enabled.

This policy applies before a capture is written to IndexedDB, so JSON backups and later Anki exports inherit the same retained URL rather than receiving the raw page URL.

## Public repository vs personal data

The repository contains code, synthetic examples, architecture notes, and tests. It must not contain a real personal corpus, exported browser data, Anki backups, or study material captured from private sessions.
