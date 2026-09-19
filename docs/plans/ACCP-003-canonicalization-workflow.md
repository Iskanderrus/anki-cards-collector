# ACCP-003: Canonicalization workflow

## Goal

Turn canonical-vs-observed support into an explicit review workflow instead of exposing it as raw editable fields.

## Dependencies

- ACCP-001 complete.
- ACCP-002 recommended.
- ACCP-011 should land before the final UI implementation so this workflow is built into the focused detail view rather than the old repeated-card layout.

## User flow

The detail view shows:

- current canonical form;
- observed forms grouped with counts;
- contexts for those forms;
- selected/best occurrence;
- whether a proposed canonical edit would rename or consolidate.

Editing the canonical form does not rewrite observed evidence.

If the edit collides with another compatible lexical unit, Collector previews consolidation before committing it.

## Implementation steps

1. Add repository/query helpers for grouped observed forms.
2. Add a canonicalization preview result: rename, consolidate, or conflict.
3. Make conflict reasons explicit, especially when both units point to different Anki notes.
4. Build the review UI in the new detail surface.
5. Return changed study content to Inbox.
6. Preserve occurrence IDs/contexts during consolidation.
7. Update accessibility/keyboard behavior.
8. Add browser tests for rename/consolidation/conflict states.

## Tests

- canonical rename with no collision;
- consolidation with one exported identity;
- conflict when both units have different Anki notes;
- observed forms preserved;
- review approval invalidated after content change.

## Non-goals

- automatic lemma selection;
- merge/split for distinct senses;
- silent canonical changes.
