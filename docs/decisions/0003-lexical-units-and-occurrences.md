# ADR 0003: Separate canonical lexical units from occurrences

**Status:** Accepted

## Context

Simple deduplication by selected text loses useful evidence. Keeping every capture as a separate card creates noise.

A learning target is also not necessarily identical to the form observed on a page. For example, an occurrence may contain `tengo ganas de` while the learner chooses `tener ganas de` as the canonical unit.

## Decision

Store the canonical learnable item as a `LexicalUnit` and each encounter as an `Occurrence`.

A lexical unit owns its canonical text, a language + normalized-canonical-text content key, review state, and optional Anki identity.

An occurrence owns the observed surface text, normalized surface text, context and source metadata, and capture time.

A repeated capture first checks direct canonical identity. If that does not match, an already-observed surface form may route the capture back to one unambiguous canonical unit.

Manual canonicalization may consolidate two compatible local units. An exported Collector identity is preserved when only one side has one. If both sides are already tied to different Anki note IDs, consolidation is rejected.

## Consequences

- canonicalization does not destroy inflected or contextual forms;
- repeated surface forms can return to a previously canonicalized unit;
- repeated contexts remain available without multiplying cards;
- changing study content invalidates prior `ready` approval and requires review again;
- v1 IndexedDB data migrates by treating its old expression as both canonical and observed, because the older schema did not retain a separate surface form;
- homographs or genuinely separate senses still require an explicit future split operation.
