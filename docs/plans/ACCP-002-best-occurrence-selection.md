# ACCP-002: Best occurrence selection

## Goal

Stop using the newest occurrence by default when a lexical unit has better evidence elsewhere in its history.

The same selected occurrence must drive review, TSV, and Anki export.

## Dependencies

- ACCP-001 complete.
- No dependency on the sidebar redesign for core selection logic.

## Design

Introduce a deterministic occurrence selector in the learning domain layer.

Candidate scoring should consider:

- whether the observed surface form occurs in the context;
- useful context on both sides of the target when relevant;
- context length bounds;
- obvious noise/empty context;
- evidence usable by the intended card kind.

Recency is a tie-breaker, not the main quality signal.

The selector returns both the chosen occurrence and an explainable score/reason.

No external service or language-specific morphology is involved.

## Implementation steps

1. Add a pure occurrence-quality module.
2. Define deterministic score components and tie-breaking.
3. Add fixtures where an older occurrence is clearly stronger than a newer one.
4. Replace direct `occurrences.at(-1)` use in learning proposal generation.
5. Ensure Anki and TSV export consume the proposal-selected occurrence.
6. Surface selected-occurrence information in review without coupling the selector to React.
7. Add browser regression coverage for repeated captures.

## Tests

- stable score/order for identical input;
- older strong context beats newer weak context;
- no target-in-context falls back safely;
- duplicate occurrence evidence does not create duplicate study targets;
- review/export parity.

## Non-goals

- morphology inference;
- semantic ranking by an LLM;
- multiple cards per occurrence;
- user-controlled occurrence pinning in this item.

## Acceptance

Matches issue ACCP-002 and must keep selection local, deterministic, and explainable.
