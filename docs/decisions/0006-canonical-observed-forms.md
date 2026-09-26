# ADR 0006: Preserve canonical and observed form identity

**Status:** Accepted; lexical identity semantics amended by [ADR 0012](0012-lexical-id-primary-identity.md)

## Context

The review policy needs two different strings for many useful language items: the learning target the learner intends to remember, and the concrete form that appeared in the source context.

Using one field for both makes contextual production brittle and loses evidence after manual normalization.

## Decision

Canonical content lives on `LexicalUnit`; observed evidence lives on `Occurrence`.

The IndexedDB schema indexes normalized observed forms so repeated surface evidence can discover possible lexical owners. The canonical `contentKey` is also indexed, but since ACCP-004 it is deliberately non-unique. Stable lexical identity is `LexicalUnit.id`, not canonical spelling.

Canonical edits preserve the lexical-unit ID and never consolidate merely because another unit already has the same canonical form. Explicit merge/split semantics and Anki identity behavior are defined in ADR 0012.

JSON backup versions 2 and 3 retain explicit canonical/observed values; backup version 4 additionally permits duplicate canonical content keys. Older backups and databases remain readable through deterministic migration.

## Consequences

The card policy can blank the actual observed form from context while still teaching the canonical form.

The persistent corpus remains faithful to what was seen even after the learner edits the canonical target.

Homographs and deliberately separate senses can share canonical text while remaining independently reviewable/exportable.

Future morphology or lemma assistance can propose relationships without becoming an implicit identity engine.
