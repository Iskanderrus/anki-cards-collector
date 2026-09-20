# Manual ACCP-017 deck-analysis acceptance

Run this against real Anki Desktop + AnkiConnect before closing ACCP-017.

The purpose is to prove that Collector can show useful evidence about an existing deck without changing anything in Anki.

## 1. Build and reload

```bash
git switch accp-017-deck-model-analysis
git pull --ff-only
npm install
npm run check
npm run build
```

Reload the unpacked extension in `chrome://extensions`.

Open **Settings & Anki** and click **Refresh from Anki**.

## 2. Inspect a real deck

Use a configured language deck that already contains cards.

Click **Inspect** beside that deck.

Verify:

- the panel names the selected deck;
- if the selected deck has subdecks, their matching cards are part of the Anki deck-search scope;
- it reports the total matching card count;
- it reports how many cards were sampled/inspected;
- one or more existing note-type/model names are shown;
- the counts are visibly described as sampled/inspected evidence, not as an automatic recommendation;
- representative **Front** and **Back** previews correspond to real cards you recognize from Anki;
- template/card ordinal metadata is plausible where shown;
- CSS is reported only as metadata.

For a deck larger than 24 cards, confirm the UI indicates bounded sampling and does not try to render the whole deck.

## 3. Mixed-model evidence

If you have a deck with more than one note type, use it for the strongest acceptance.

Verify all sampled model names remain visible separately. Collector must **not** silently choose the most frequent model.

If no real mixed-model deck is readily available, record that limitation; deterministic mixed-model behavior is covered by automated tests and browser E2E.

## 4. Mutation safety

Before and after inspection, verify the real Anki deck has not changed:

- no cards moved decks;
- no note fields were added/changed;
- no templates or CSS were rewritten;
- scheduling/review state is unchanged by Collector inspection.

Inspection is read-only and uses only `findCards` + bounded `cardsInfo`.

## 5. Privacy

Do not publish screenshots containing private study content in the public issue/PR.

For the public acceptance record, document only:

- deck name if it is non-sensitive (otherwise say “real existing deck”);
- total card count and sample size if acceptable;
- sampled model names if non-sensitive;
- whether representative front/back matched Anki;
- whether any mutation was observed.

Representative card contents remain local.
