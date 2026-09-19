# User journey

## Primary job

Collector should let someone notice useful language while reading, save it with context, decide later whether it is worth studying, and send approved material to the correct Anki destination without breaking reading flow.

The normal loop is:

```text
capture now -> review later -> export confidently -> update safely
```

ACCP-012 owns the onboarding and flow implementation.

## Current friction

The current extension works, but the user has to understand too much implementation detail:

- capture and review are visually mixed;
- settings dominate the side panel;
- every item is expanded;
- destination is global and easy to forget;
- export configuration is expressed as raw deck/model text;
- error messages can be technically correct without explaining the next user action.

That is workable for a developer test but not comfortable daily use.

## First-run journey

A first-time user should be able to understand the product in under a minute.

First-run should explain:

1. Select text on a page.
2. Collect it locally.
3. Review the Inbox later.
4. Ready means approved for export.
5. Collector can route different languages to different Anki profiles.
6. Anki Desktop + AnkiConnect are required for direct export.
7. Browsing is not collected in the background.

First-run should be skippable and reopenable.

## Capture journey

Capture should interrupt reading as little as possible.

Target flow:

```text
select text
  -> Collect
  -> lightweight confirmation
  -> continue reading
```

The user should not be forced into editing after every capture.

If a capture matches an existing lexical unit, the confirmation may mention that a new occurrence was added, but the user should still be able to continue immediately.

## Review journey

Review is a separate intentional activity.

Target flow:

```text
open Inbox
  -> compact queue
  -> open item
  -> inspect selected occurrence + proposal
  -> Ready / Edit / Archive
  -> next item
```

A dedicated review-session mode may streamline this sequence, but it must not hide the underlying state.

## Export journey

The user needs confidence before export.

Before exporting, Collector should make clear:

- how many items are Ready;
- where they are going;
- whether several destinations are involved;
- whether an existing note will be updated or a new one created;
- which items are blocked.

During export, progress is batch-level with per-item isolation.

After export, the result should distinguish:

- exported/updated successfully;
- recovered successfully after a stale Anki note;
- local persistence warning;
- hard failure requiring user action.

## Multilingual journey

A multilingual user should not have to change a global deck before each batch.

Example:

```text
שלום       he -> Hebrew profile  -> Hebrew RU
dolaziti   sr -> Serbian profile -> Serbian RU
aunque     es -> Spanish profile -> Spanish RU — Uruguay
```

The destination should be derived from routing rules and remain visible in review.

A per-item override should exist for deliberate exceptions.

## Existing Anki workflow

Collector should adapt to an existing Anki setup rather than forcing the user to rebuild it around Collector.

The preferred journey is:

```text
connect Anki
  -> choose existing deck/note type
  -> map Collector fields once
  -> save export profile
  -> reuse profile automatically
```

Collector Basic remains a safe default for users who do not have an existing model they want to reuse.

## Recovery journey

Failures should not strand study material.

Examples:

- Anki not running -> explain how to retry.
- Stored note was deleted -> recover by stable Collector identity and create/update safely.
- Destination changed -> ask whether to move/retarget.
- Model mapping invalid -> block before batch export, not midway through it.

## Non-goals

The journey does not include:

- background scraping;
- automatic page-wide collection;
- silently deciding that ambiguous language material is correct;
- silently moving existing Anki cards between decks.
