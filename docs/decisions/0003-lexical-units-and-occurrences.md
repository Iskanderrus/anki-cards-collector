# ADR 0003: Separate lexical units from occurrences

**Status:** Accepted

## Context

Simple deduplication by selected text loses useful evidence. Keeping every capture as a separate card creates noise.

The same expression can appear many times, and those repeated encounters are useful context even when the learner only wants one Anki note.

## Decision

Store the learnable item as a `LexicalUnit` and each encounter as an `Occurrence`.

A language + normalised-text content key deduplicates lexical units locally. Every explicit capture still appends an occurrence with context and source metadata.

## Consequences

- duplicate capture does not create duplicate study items;
- repeated contexts remain available for later ranking or card generation;
- changing normalisation rules will require an explicit migration;
- homographs that genuinely need separate senses will eventually need a user-controlled split operation.
