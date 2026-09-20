# Manual ACCP-013 export-profile acceptance

Run this against real Anki Desktop + AnkiConnect before closing ACCP-013.

The purpose is to prove routing and identity with real decks. Do **not** use a user-owned note type for export in this ticket; ACCP-014 adds explicit field mapping for those models.

## Safety

1. Sync/backup Anki normally before the run.
2. Keep any personal backup JSON or screenshots containing study content out of the public issue.
3. Use two existing destination decks. Hebrew and Serbian are a useful real-world pair, but any two existing decks are valid.
4. Use the Collector-managed note type (`Collector Basic`) for this acceptance.

## 1. Build and reload

```bash
git switch accp-013-export-profiles
git pull --ff-only
npm install
npm run check
npm run build
```

Reload the unpacked extension in `chrome://extensions`.

Open the side panel and expand **Settings & fallback exports**.

## 2. Verify live catalog and profile setup

1. Click **Refresh from Anki**.
2. Confirm the two real destination decks appear.
3. Configure/rename the default profile for the first deck.
4. Click **Add profile** and choose the second live deck.
5. Confirm both profiles show `Collector Basic` as the Collector-managed note type.
6. Confirm arbitrary existing user note types are not selectable as Collector-managed export models.

Creating an additional profile must require a live existing deck; a stale/missing added-profile deck must not be silently created.

## 3. Configure two language routes

Create two routes, for example:

```text
he -> Hebrew profile
sr -> Serbian profile
```

Confirm both appear in the routing list.

## 4. Mixed Ready batch

Prepare at least one Ready Collector item for each routed language.

Before export, confirm each item's **Destination** line shows the expected profile/deck.

Click **Send ready to Anki** once.

Verify in Anki:

- both items were exported;
- the first language is in the first configured deck;
- the second language is in the second configured deck;
- both use the Collector-managed note type;
- no user-owned model fields/templates/CSS were modified.

Record only the two Anki note IDs and destination deck names if a public acceptance comment is needed; do not publish the study text.

## 5. Binding pin test

After the successful export:

1. note each exported item's Anki note ID;
2. change the language route/fallback so it would now resolve somewhere else for an unbound item;
3. re-export the same Ready items.

Verify:

- each existing note keeps the same Anki note ID;
- neither existing card moves decks merely because the route/default changed;
- the side panel still shows the pinned destination snapshot.

## 6. Explicit same-model move

For one exported item:

1. choose the other Collector-managed profile in the item's destination control;
2. confirm that changing the selector alone does not move the Anki card;
3. click **Move exported note**;
4. verify the card moves to the target deck;
5. verify the Anki note ID stays unchanged;
6. re-export and confirm the moved destination remains pinned.

A move that would change note type must be blocked until ACCP-014.

## 7. v2 -> v3 identity migration spot-check

If the local Collector database contains a note exported before ACCP-013:

1. record its existing Anki note ID before reloading the new build;
2. open the new side panel so IndexedDB upgrades to v3;
3. re-export that item.

Verify the same Anki note is updated rather than duplicated. Its new `ExportBinding` should preserve the existing note ID and pin the migrated default destination.

## Acceptance record

Record:

- browser/version;
- Anki Desktop + AnkiConnect version if convenient;
- two deck names;
- whether the mixed batch routed correctly;
- note IDs before/after the pin test;
- explicit move result;
- v2->v3 existing-note identity result if an older exported item was available;
- any unexpected deck/model mutation.

Do not attach private corpus backups or screenshots that reveal study content unless intentionally redacted.
