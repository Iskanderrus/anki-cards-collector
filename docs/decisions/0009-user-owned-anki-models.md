# ADR 0009: Treat user-owned Anki note types as read-only and integrate through field mapping

**Status:** Accepted

## Context

Collector currently owns the `Collector Basic` model and can safely migrate its known fields/templates.

That same behavior is not safe for an arbitrary existing Anki note type. A user may already have carefully designed fields, card templates, CSS, multiple card templates, mobile-specific styling, or workflows shared with other decks.

The product should let users keep that presentation instead of forcing every exported note into Collector Basic.

## Decision

Collector distinguishes between:

- **Collector-managed models**, whose schema/templates Collector owns and may migrate;
- **user-owned models**, which Collector may inspect but must not mutate automatically.

A user-owned model is integrated through explicit field mapping from Collector semantic values into fields that already exist on the model.

Collector may inspect live Anki metadata and representative existing cards through the read-only discovery boundary defined by ADR 0010.

Selecting a user-owned model never authorizes Collector to add fields or rewrite templates/CSS.

Field mappings are validated before export. A mapped profile is not considered confirmed/routable until Collector has captured both the live Anki deck ID and note-type/model ID, not merely their names. Existing export bindings snapshot those confirmed IDs so a later same-name profile replacement cannot reinterpret an already pinned destination.

Before a durable export reservation is written, Collector must verify that the mapped Prompt participates in a question side and must preflight the concrete mapped note with AnkiConnect's non-mutating addability check.

Stable Collector identity must remain available without requiring mutation of the user model.

For Collector-managed models, the existing `CollectorID` field remains valid.

For user-owned models, the preferred fallback identity is a reserved Collector tag derived from the stable lexical-unit ID. The arbitrary lexical-unit ID is encoded to a search-safe representation, and stale recovery uses exact anchored tag matching rather than ordinary wildcard/hierarchical tag search. The local Anki note ID remains the primary update locator; the exact identity tag provides stale-note recovery.

## Consequences

Users can keep their existing visual card layout and template behavior.

Collector does not need to copy or recreate arbitrary user CSS. It writes mapped values into the existing note type and lets Anki render the resulting card normally.

Representative cards can be shown during setup to help the user recognize the intended note type, but those samples do not authorize automatic model selection.

Collector Basic remains the safe default for users who do not want custom mapping.

Custom-profile setup needs compatibility validation and a preview of where semantic values will be written.

Idempotent export logic must support both CollectorID-field lookup and exact reserved-tag lookup. Missing confirmed deck/model IDs are treated as incomplete legacy configuration and must be reconfirmed before a mapped write.

Collector must not assume that all user-owned models have one card template or the same field semantics.
