# ADR 0005: Derive learning-card proposals from the local corpus

**Status:** accepted

## Context

Captured language is evidence, not automatically a good flashcard.

Persisting generated card state would duplicate information already present in a lexical unit and its occurrences, add backup/migration surface, and make it easier for stale card suggestions to survive after the source material is edited.

Repeated encounters also need to strengthen one learning target rather than silently multiplying cards.

## Decision

The review layer derives at most one deterministic learning-card proposal from each `CollectedItem`.

The policy:

- classifies the captured material;
- selects the strongest available occurrence with a local, deterministic quality scorer;
- prefers contextual retrieval when the selected source context supports it;
- uses recency only as a tie-break when occurrence quality is equal;
- exposes the occurrence-selection reason to review;
- never generates a translation or meaning that was not supplied by the learner;
- can refuse readiness when the capture is too broad or underspecified;
- treats `ready` as explicit human approval;
- sends the same derived proposal and selected occurrence to Anki and TSV;
- keeps `LexicalUnit.id` as the stable synchronization identity.

The proposal and occurrence selection are not persisted.

## Consequences

Editing a canonical form, observed form, context, or learner note immediately changes the proposed card without a database migration.

A newly captured weak occurrence cannot automatically replace an older stronger example merely because it is newer.

Backups remain a representation of the observed corpus rather than generated study output.

The first implementation intentionally limits each lexical unit to one proposal. More proposal types can be added later only if they preserve explicit review and a bounded card budget.
