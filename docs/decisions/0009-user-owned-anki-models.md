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

Collector may inspect live Anki metadata such as:

- model names;
- model field names;
- templates;

but selecting a user-owned model never authorizes Collector to add fields or rewrite templates/CSS.

Field mappings are validated before export.

Stable Collector identity must remain available without requiring mutation of the user model.

For Collector-managed models, the existing `CollectorID` field remains valid.

For user-owned models, the preferred fallback identity is a reserved Collector tag containing the stable lexical-unit ID. The local Anki note ID remains the primary update locator; the identity tag provides stale-note recovery.

## Consequences

Users can keep their existing visual card layout and template behavior.

Collector Basic remains the safe default for users who do not want custom mapping.

Custom-profile setup needs compatibility validation and a preview of where semantic values will be written.

Idempotent export logic must support both CollectorID-field lookup and reserved-tag lookup.

Collector must not assume that all user-owned models have one card template or the same field semantics.
