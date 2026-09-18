# Learning-card policy

The collector does not treat every captured string as a finished flashcard.

A capture first becomes a `LexicalUnit` with one or more `Occurrence` records. Review then derives one learning-card proposal from that local evidence.

## Current policy

The first policy is deliberately small and deterministic.

- classify the selected material as a word, chunk, or sentence;
- derive at most one card proposal per lexical unit;
- prefer contextual production for a multi-word expression when the captured context can be turned into a useful prompt;
- use the learner's own note when an explicit meaning or distinction is needed;
- do not manufacture translations or semantic explanations;
- treat repeated encounters as additional evidence for the same learning target, not as a reason to create duplicate cards;
- block captures that are too broad or do not yet have a useful retrieval target;
- require the user to mark the item `ready` before export.

## Why proposals are derived

Card proposals are not stored in IndexedDB.

They are a pure function of the current lexical unit and its occurrences. Editing the expression, learner note, or latest context immediately changes the proposal.

This keeps the persistent corpus about observed material rather than one rendering of that material. It also means JSON backups do not need a separate schema for generated card state.

## Card kinds

### Context recognition

Used for a single lexical item when the available evidence supports recognition but not a stronger production prompt.

If a learner note exists, it becomes the explicit answer. Otherwise the original context is shown rather than inventing a meaning.

### Context production

Preferred for a short multi-word expression when it appears inside enough surrounding context.

The expression is blanked from the context and becomes the answer.

### Context recall

Used when a sentence has useful surrounding context and can be recalled from that context without adding generated semantic claims.

### Sentence review

Used for a sentence whose learner note provides the concrete review target.

A sentence without a useful surrounding prompt or learner note remains in the inbox until it is narrowed or annotated.

## Review budget

The current policy deliberately has a one-proposal budget.

One lexical unit maps to one stable Collector note identity. A repeated encounter can improve the evidence and therefore the proposal, but it does not automatically increase the number of cards.

## Export

The proposal shown in the side panel is the proposal sent to Anki and the proposal written to TSV.

The exported note carries:

- `CollectorID`;
- `Prompt`;
- `Answer`;
- `CardKind`;
- `Why`;
- the original expression, context, learner note, and retained source URL.

The stable Collector ID remains the synchronization key. If an edit changes the suggested prompt or card kind, the next export updates the same Anki note.
