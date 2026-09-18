# ADR 0006: Preserve canonical and observed form identity

**Status:** Accepted

## Context

The review policy needs two different strings for many useful language items: the stable learning target the learner intends to remember, and the concrete form that appeared in the source context.

Using one field for both makes contextual production brittle and loses evidence after manual normalization.

## Decision

Canonical identity lives on `LexicalUnit`; observed identity lives on `Occurrence`.

The current IndexedDB schema indexes normalized observed forms so a repeated surface form can resolve back to its canonical unit. JSON backup version 2 records both values explicitly. Version 1 backups and databases remain readable through deterministic migration.

Consolidation is local and conservative. It preserves an existing exported Collector identity when possible and refuses to merge two units linked to different Anki notes.

## Consequences

The card policy can blank the actual observed form from context while still teaching the canonical form.

The persistent corpus remains faithful to what was seen even after the learner edits the canonical target.

Future morphology or lemma assistance can propose relationships without requiring another fundamental storage redesign.
