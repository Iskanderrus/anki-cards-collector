# ADR 0008: Route Anki export through explicit export profiles

**Status:** Accepted

## Context

Current Collector settings have one global deck and one global model. Every Ready item in a batch uses those values.

That is unsafe for multilingual use. A queue can contain Hebrew, Serbian, Spanish, or other material at the same time, and a forgotten global deck setting can route unrelated items to the wrong destination.

Changing a global deck string also does not express what should happen to an item that was already exported. Updating fields, moving cards, and changing note type are different operations.

Destination state is operational metadata, not part of lexical identity.

## Decision

Collector will introduce explicit **ExportProfile** configuration and a separate per-item **ExportBinding**.

An ExportProfile describes a reusable destination/presentation configuration, including at least:

- stable profile ID;
- human-readable name;
- first-class language for guided profiles;
- Anki deck;
- Anki model;
- managed-model or mapped-model mode;
- field mapping when applicable.

Routing resolves in this order:

1. explicit per-item profile override;
2. configured language route;
3. fallback profile.

For capture, ACCP-018 may select an active `captureProfileId`. When that profile has a first-class language (or exactly one unambiguous legacy language route), capture uses that language. The historical global `defaultLanguage` remains a conservative fallback and is not deleted or silently projected onto old profiles.

The first successful export pins the effective destination through an ExportBinding associated with the lexical unit.

An ExportBinding records enough information to update the same Anki relationship safely, including the profile and Anki note ID. Later changes to global routing do not silently reinterpret an already-exported item.

A deliberate destination change is an explicit user action. If it implies moving an existing Anki card or changing model compatibility, Collector must preview/confirm that operation.

Batch export groups Ready items by effective profile instead of applying one global destination to the entire batch.

## Consequences

A multilingual batch can route to multiple decks safely.

Language routing becomes convenience rather than hidden global state.

Backup/restore and storage migration need a clear representation for export bindings.

The UI must make destination visible enough that a user can detect an unexpected route before export.

Existing single-deck settings need a deterministic migration into a default export profile.
