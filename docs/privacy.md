# Privacy boundary

The short version: the extension is designed so there is very little to trust.

## Data that stays local

Collected expressions, contexts, source URLs, review states, and Anki note IDs live in the extension's IndexedDB storage.

Settings live in `chrome.storage.local`.

The extension has no application server, analytics SDK, telemetry endpoint, or account system.

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

## What a captured URL can reveal

A source URL is useful study context, but URLs can contain private identifiers or query parameters on some sites. The current implementation stores the source URL as-is.

URL sanitisation is tracked as a public hardening item before packaging the extension for broader distribution.

## Public repository vs personal data

The repository contains code, synthetic examples, architecture notes, and tests. It must not contain a real personal corpus, exported browser data, Anki backups, or study material captured from private sessions.
