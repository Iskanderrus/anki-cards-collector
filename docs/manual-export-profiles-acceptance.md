# Manual ACCP-013 Anki deck-routing acceptance

Run this against real Anki Desktop + AnkiConnect before closing ACCP-013.

The user-facing goal is simple: choose an Anki deck for each language, then export one mixed Ready batch safely.

## 1. Build and reload

```bash
git switch accp-013-export-profiles
git pull --ff-only
npm install
npm run check
npm run build
```

Reload the unpacked extension in `chrome://extensions`.

Open the side panel and expand **Settings & Anki**.

## 2. Load your Anki decks

1. Click **Refresh from Anki**.
2. Confirm Collector reports a successful connection and shows your real decks.
3. Under **Anki decks by language**, set:
   - `he` → your Hebrew deck;
   - `sr` → your Serbian deck;
   - `es` → your Spanish deck.
4. Set **Other languages** to the deck you want as the general fallback.

Collector uses its own `Collector Basic` note type for new cards. Existing Anki cards that were previously linked to a custom note type are left unchanged rather than rewritten.

## 3. Explicit missing-deck creation

Export must never create a missing deck by itself.

If a saved destination is missing from live Anki, Collector shows **Create deck** beside that destination.

Verify:

1. the deck is absent in Anki;
2. merely exporting or refreshing does not create it;
3. click **Create deck**;
4. only then confirm the deck appears in Anki.

## 4. Mixed three-language export

Prepare at least one **new/unexported** Ready Collector item for each language: Hebrew, Serbian, and Spanish.

Before export, each card should show only a simple destination line such as:

```text
Anki: Hebrew deck
Anki: Serbian deck
Anki: Spanish deck
```

Click **Send ready to Anki** once.

Verify in Anki:

- all three new cards were exported in the same operation;
- each card landed in the configured language deck;
- each card uses `Collector Basic`;
- no existing user-owned note type was modified.

Old cards already linked to custom Anki note types may be skipped with a neutral message; they must not be rewritten or reported as three generic export failures.

## 5. Destination pin test

Choose one of the newly exported cards and record its Anki note ID.

Then change that language's deck rule to another deck and export again.

Verify:

- the existing note keeps the same Anki note ID;
- it stays in its original deck;
- the card still shows its pinned Anki deck.

Changing a language rule affects future/unbound cards, not already-exported notes.

## 6. Deliberate move

For the same exported card:

1. open **Move to another deck…**;
2. choose another deck;
3. confirm that selection alone does not move the Anki card;
4. click **Move**;
5. verify the card moves to the chosen deck;
6. verify the Anki note ID stays unchanged;
7. export again and confirm it remains pinned there.

## 7. Legacy identity spot-check

If an item was already exported before ACCP-013, confirm its existing Anki note ID is still displayed after the v2 → v3 local database upgrade.

If that old card uses a custom note type, Collector should leave it unchanged until explicit custom-note mapping is implemented.

## Acceptance record

Record only:

- the Hebrew, Serbian, and Spanish deck names;
- whether one mixed export routed all three correctly;
- one note ID before/after the pin test;
- the explicit move result;
- whether any old custom-note card was left unchanged as expected.

Do not publish private study text or corpus backups.


## Final live acceptance — 2026-09-20

Status: **PASSED** on real Anki Desktop + AnkiConnect.

Verified without publishing private study text:

- Anki connection succeeded and live deck discovery loaded 7 decks;
- language routing was configured for Spanish, Hebrew, and Serbian against real destination decks;
- the simplified `language → Anki deck` UI was clear enough to use without exposing internal export-profile concepts;
- one bulk **Send ready to Anki** operation completed successfully with 4 exportable Ready items;
- a real Collector-managed Anki note was inspected after export and contained the expected Collector fields, including stable Collector ID, prompt/answer, card kind, canonical/observed form, context, and note metadata;
- already-linked custom-note cards remained protected from unsafe rewriting;
- destination pinning / deliberate move behavior was exercised successfully during acceptance;
- no unexpected deck or user-owned note-type mutation was observed.

The screenshots used during acceptance are intentionally not attached to the public repository because they contain study content.
