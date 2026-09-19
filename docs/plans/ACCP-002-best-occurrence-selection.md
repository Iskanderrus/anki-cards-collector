# ACCP-002: Best occurrence selection

## Status

Implemented in code; browser/CI acceptance remains before closure.

## Goal

Stop using the newest occurrence by default when a lexical unit has better evidence elsewhere in its history.

The same selected occurrence drives review, TSV, and Anki export.

## Dependencies

- ACCP-001 complete.
- No dependency on the sidebar redesign for core selection logic.

## Implemented design

A pure occurrence-quality module scores every occurrence using deterministic local signals:

- observed surface present in context;
- surrounding words on one/both sides;
- residual context after blanking;
- bounded context length;
- obvious URL/punctuation/symbol noise;
- contextual-blank usability for chunk/sentence proposals.

Recency contributes no score. It is used only when quality scores are equal. Occurrence ID provides a final stable tie-break.

The selector returns:

- selected occurrence;
- total score;
- score breakdown;
- chronological occurrence number/count;
- explainable selection reason;
- whether recency resolved a quality tie.

No external service or language-specific morphology is involved.

## Proposal/export parity

`proposeLearningCard` owns occurrence selection.

The derived proposal carries the selection result, and:

- review renders the selected context/observed form/source;
- edit starts from the currently selected occurrence;
- TSV uses the proposal-selected occurrence;
- Anki fields use the proposal-selected occurrence.

There is no separate "latest occurrence" decision inside export.

## Tests

Automated coverage includes:

- stronger older context beating weaker newer context;
- recency only resolving equal-quality ties;
- stable ID tie-break independent of input order;
- observed target required for contextual blank;
- noisy-context penalty;
- safe no-occurrence fallback;
- policy using selected occurrence;
- TSV review/export parity;
- Anki field parity;
- browser repeated-capture regression showing one lexical unit with two occurrences and the older stronger context still selected.

## Non-goals

- morphology inference;
- semantic ranking by an LLM;
- multiple cards per occurrence;
- user-controlled occurrence pinning in this item.

## Acceptance

Close ACCP-002 after the PR passes normal checks, Chromium E2E/accessibility, and store packaging.
