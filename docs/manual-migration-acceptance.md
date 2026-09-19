# Manual v1 -> v2 migration acceptance

This check is performed against an existing browser profile/database and an existing Anki collection. Automated migration tests remain useful, but they do not replace a real upgrade.

The helper is read-only toward Anki. The only Anki write in this procedure is the normal Send ready to Anki action from the extension.

## What this proves

The check verifies:

1. the real IndexedDB v1 corpus opens as v2 without losing Collector IDs, review state, learner notes, timestamps, contexts, sources, occurrence IDs, or stored Anki note IDs;
2. the v1 expression becomes the v2 canonical form and the old occurrence receives the same text as its observed form;
3. re-export updates the same Anki note and keeps the same card IDs;
4. Anki scheduling counters (reps, lapses, interval, factor) do not change when note fields are updated.

Do not study the selected target card between snapshot and final verification.

## Safety first

Before changing the installed extension:

1. Open the currently installed v1 Collector.
2. Use Backup JSON and save it outside the repository as /tmp/accp-before-v1.json.
3. Confirm the file contains version 1.
4. Keep that file until acceptance is complete.

For an additional raw-browser safety copy, note the extension ID at chrome://extensions, fully close the browser, then copy the extension IndexedDB directory.

Common Linux locations:

    ~/.config/google-chrome/<Profile>/IndexedDB/chrome-extension_<EXTENSION_ID>_0.indexeddb.leveldb
    ~/.config/chromium/<Profile>/IndexedDB/chrome-extension_<EXTENSION_ID>_0.indexeddb.leveldb
    ~/.config/BraveSoftware/Brave-Browser/<Profile>/IndexedDB/chrome-extension_<EXTENSION_ID>_0.indexeddb.leveldb

Do not copy LevelDB while the browser is running.

## 1. Prepare the helper without reloading the extension

Pull current main, but do not rebuild/reload the installed extension yet:

    git switch main
    git pull --ff-only
    npm install
    node scripts/manual-migration-check.mjs self-test

The installed browser extension should still be the old v1 build.

## 2. Pick one real exported item

With Anki running and AnkiConnect enabled:

    node scripts/manual-migration-check.mjs list-candidates /tmp/accp-before-v1.json

Choose a Collector ID with an ankiNoteId. Prefer a card that already has review history.

Take an Anki snapshot:

    node scripts/manual-migration-check.mjs snapshot /tmp/accp-before-v1.json <COLLECTOR_ID> /tmp/accp-anki-before.json

The command prints scheduling counters. Do not review that card until verification is complete.

## 3. Upgrade the same installed extension

Rebuild in the same checkout/path that the unpacked extension already points to. That keeps the same extension origin and IndexedDB database.

Run:

    npm run check
    npm run build

Then open chrome://extensions and click Reload for Anki Cards Collector.

Open the side panel. This first open runs the v1 -> v2 migration on the real database.

## 4. Export the post-migration corpus

Use Backup JSON again and save /tmp/accp-after-v2.json. Confirm it contains version 2.

Verify the browser/database migration before touching Anki:

    node scripts/manual-migration-check.mjs verify-corpus /tmp/accp-before-v1.json /tmp/accp-after-v2.json

Expected:

    PASS: verified <N> lexical units and <M> occurrences.

If this fails, stop and do not re-export to Anki.

## 5. Re-export through the upgraded extension

Find the target Collector item chosen earlier. If it is already ready, leave it ready. Otherwise review its proposed card and mark it ready deliberately.

Use Send ready to Anki. This is the real production export path. It may update every item currently marked ready.

After export, create a fresh v2 backup at /tmp/accp-after-v2.json.

## 6. Verify Anki identity and study history

Run:

    node scripts/manual-migration-check.mjs verify /tmp/accp-before-v1.json /tmp/accp-after-v2.json /tmp/accp-anki-before.json

A complete pass reports four PASS lines covering corpus preservation, note/card identity, scheduling counters, and Canonical/Observed/CollectorID fields.

## Acceptance record

Record in ACCP-001:

- browser family and version;
- profile name;
- v1 lexical-unit and occurrence counts;
- target Collector ID, without private study content;
- target Anki note ID;
- whether the target had non-zero review history;
- verify-corpus result;
- final verify result;
- any unexpected UI or migration behavior.

Do not attach backup files or the raw IndexedDB directory to the public issue; they may contain personal study material and source URLs.
