# ADR 0004: Make Anki export idempotent

**Status:** Accepted

## Context

Export buttons are easy to press twice. Users also edit source data after a note has already reached Anki.

Treating export as “always add a note” turns retries into duplicate cards and makes the integration unsafe.

## Decision

Every lexical unit has a stable Collector ID.

The Collector note type includes that ID as a field. After the first export, the returned Anki note ID is stored locally. Later exports update that note. If the local Anki note ID is missing or stale, the client searches by Collector ID before creating a replacement.

## Consequences

- retrying an export is safe;
- card content can evolve without changing identity;
- deleting a note in Anki is recoverable;
- changing the target note type requires an explicit compatibility decision rather than silent field guessing.
