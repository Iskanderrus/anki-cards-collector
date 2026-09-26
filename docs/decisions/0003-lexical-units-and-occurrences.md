# ADR 0003: Separate canonical lexical units from occurrences

**Status:** Accepted; identity details amended by [ADR 0012](0012-lexical-id-primary-identity.md)

## Context

Simple deduplication by selected text loses useful evidence. Keeping every capture as a separate card creates noise.

A learning target is also not necessarily identical to the form observed on a page. For example, an occurrence may contain `tengo ganas de` while the learner chooses `tener ganas de` as the canonical unit.

## Decision

Store the learnable item as a `LexicalUnit` and each encounter as an `Occurrence`.

A lexical unit owns a stable lexical-unit ID, canonical text, derived language + normalized-canonical-text content key, review state, and optional Anki identity. The lexical-unit ID is identity; the content key is non-unique lookup data.

An occurrence owns a stable occurrence ID, its owning lexical-unit ID, observed surface text, normalized surface text, context and source metadata, and capture time.

A repeated capture may use canonical and observed-form indexes to discover possible owners. One unambiguous owner may receive the new evidence. Multiple plausible owners require explicit ownership resolution rather than first-match selection.

Canonical editing changes one lexical unit in place. Canonical equality does not imply identity equality and never causes an automatic merge. Identity consolidation is the explicit ACCP-004 merge operation; deliberate separation is the explicit split operation defined by ADR 0012.

## Consequences

- canonicalization does not destroy inflected or contextual forms;
- repeated surface forms can return to one unambiguous canonicalized unit;
- same-canonical homographs and separate senses can coexist under different lexical IDs;
- repeated contexts remain available without multiplying lexical identities;
- changing study evidence invalidates prior `ready` approval and requires review again;
- v1 IndexedDB data still migrates by treating its old expression as both canonical and observed, because the older schema did not retain a separate surface form;
- merge/split preserve occurrence IDs and obey the Anki identity rules in ADR 0012.
