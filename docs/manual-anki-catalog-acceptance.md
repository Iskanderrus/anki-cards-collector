# Manual Anki catalog acceptance

Use this after the ACCP-016 implementation has passed automated CI.

## Preconditions

- Anki Desktop is running.
- AnkiConnect is installed and listening on the normal local endpoint.
- The Collector extension has been rebuilt/reloaded from the ACCP-016 build.
- Use an Anki profile where you can recognize at least two deck names and one custom note type.

This acceptance is read-only. Do not export Collector items during the check.

## 1. Freeze a simple before snapshot

In Anki, note:

- the visible deck names you expect Collector to discover;
- one note type you know well;
- that note type's field names and card-template names.

No scheduling action is required.

## 2. Refresh the live catalog

Open Collector:

1. expand **Settings & fallback exports**;
2. under **Live Anki catalog**, click **Refresh from Anki**.

Expected:

- status says **Connected**;
- deck count is plausible;
- note-type count is plausible;
- the deck selector contains your real Anki decks;
- the note-type selector contains your real note types.

## 3. Inspect one existing note type

Choose a note type you recognize.

Expected inspector output:

- note-type name;
- field names matching Anki;
- card-template names matching Anki;
- a styling summary indicating CSS was returned when the model has styling.

Collector must not add Collector-specific fields to this note type merely because you inspected it.

## 4. Test persistent stale fallback

After a successful refresh/inspection:

1. close Anki Desktop;
2. close and reopen the Collector side panel (this deliberately remounts the UI);
3. click **Refresh from Anki**.

Expected:

- Collector reports that it is showing the last successful catalog and the new refresh failed;
- previously discovered decks/note types remain selectable from stale local metadata;
- the inspected model can still show cached field/template/styling metadata;
- saved Collector settings remain unchanged.

This cache contains discovery metadata only; it does not persist sampled cards or note contents.

## 5. Verify no mutation

Reopen Anki and confirm:

- no new deck appeared;
- no deck was renamed or moved;
- the inspected note type has the same fields;
- its templates/CSS are unchanged;
- no notes/cards were created or updated by refresh/inspection.

## 6. Report

Record:

- Collector commit tested;
- Anki version;
- AnkiConnect version returned by Collector if visible/known;
- one or two discovered deck names;
- inspected note-type name;
- PASS/FAIL for deck discovery;
- PASS/FAIL for model fields/templates;
- PASS/FAIL for persistent stale fallback;
- PASS/FAIL for no mutation.

Do not publish card contents, private source URLs, or collection backups in a public issue comment.
