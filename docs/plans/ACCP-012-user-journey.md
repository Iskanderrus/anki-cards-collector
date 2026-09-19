# ACCP-012: User journey and onboarding

## Goal

Make capture -> review -> export understandable and comfortable without repository knowledge.

## Dependencies

- ACCP-011.
- ACCP-013.

## First run

Add a short skippable/reopenable introduction covering:

- collect selected text;
- local Inbox;
- Ready state;
- Anki/AnkiConnect;
- export profiles/destinations;
- local-first/privacy boundary.

Do not force full setup before the user can inspect the extension.

## Capture feedback

After capture:

- confirm success briefly;
- distinguish new lexical unit vs added occurrence where useful;
- do not force detail view;
- preserve reading flow.

## Review session

Provide a deliberate queue-review path:

- open next Inbox item;
- inspect/edit;
- Ready/Archive;
- continue.

The normal queue remains available outside session mode.

## Export confidence

Before/during export communicate:

- number of Ready items;
- number of destination profiles;
- blocked items;
- progress by item/profile;
- final successes/warnings/failures.

Error copy should suggest the next action when known.

## Settings organization

Organize around tasks:

- Languages & routing
- Anki connection/profiles
- Privacy/source retention
- Backup/restore
- Advanced

## Tests

Browser journeys:

- first run -> capture -> review -> export;
- skip/reopen onboarding;
- Anki unavailable;
- mixed-destination batch;
- keyboard-only review.
