# Learning-card policy

The collector does not treat every captured string as a finished flashcard.

A capture first becomes a canonical `LexicalUnit` with one or more `Occurrence` records containing the surface forms actually observed. Review then derives one learning-card proposal from that local evidence.

## Current policy

The first policy is deliberately small and deterministic.

- classify the canonical learning target as a word, chunk, or sentence;
- score available occurrences and select the strongest evidence rather than simply taking the newest capture;
- derive at most one card proposal per lexical unit;
- prefer contextual production for a multi-word canonical unit when its selected observed surface form can be blanked from the selected context;
- use the learner's own note when an explicit meaning or distinction is needed;
- do not manufacture translations or semantic explanations;
- treat repeated encounters as additional evidence for the same learning target, not as a reason to create duplicate cards;
- block captures that are too broad or do not yet have a useful retrieval target;
- require the user to mark the item `ready` before export.

## Occurrence selection

Occurrence quality is local and deterministic.

The scorer considers:

- whether the observed surface form actually appears in context;
- how much useful context remains around the target;
- whether context exists on both sides;
- bounded context length;
- obvious URL/punctuation/symbol noise;
- whether a contextual blank is usable for chunk/sentence proposals.

Recency does not add quality points. It is only a deterministic tie-break when two occurrences have the same quality score. A stable occurrence ID is the final tie-break when score and capture time are equal.

The review UI shows which occurrence drives the card proposal and an explainable score summary.

No morphology model, external API, or LLM is used by this selector.

## Why proposals are derived

Card proposals are not stored in IndexedDB.

They are a pure function of the current canonical lexical unit and all of its occurrences. Editing the canonical form, observed form, learner note, or context can immediately change both the selected occurrence and the proposal.

This keeps the persistent corpus about observed material rather than one rendering of that material. It also means JSON backups do not need a separate schema for generated card state.

## Card kinds

### Context recognition

Used for a single lexical item when the available evidence supports recognition but not a stronger production prompt.

If a learner note exists, it becomes the explicit answer. Otherwise the selected original context is shown rather than inventing a meaning.

### Context production

Preferred for a short multi-word expression when it appears inside enough surrounding context.

The selected observed surface form is blanked from the selected context. The answer keeps that observed form and also shows the canonical form when the two differ.

### Context recall

Used when a sentence has useful surrounding context and can be recalled from that context without adding generated semantic claims.

### Sentence review

Used for a sentence whose learner note provides the concrete review target.

A sentence without a useful surrounding prompt or learner note remains in the inbox until it is narrowed or annotated.

## Review budget

The current policy deliberately has a one-proposal budget.

One lexical unit maps to one stable Collector note identity. A repeated encounter can improve the evidence and therefore the proposal, but it does not automatically increase the number of cards.

## Export

The proposal and selected occurrence shown in the side panel are the same proposal/evidence pair sent to Anki and written to TSV.

The exported note carries:

- `CollectorID`;
- `Prompt`;
- `Answer`;
- `CardKind`;
- `Why`;
- the canonical form;
- selected observed form;
- selected context;
- learner note;
- retained source URL from the selected occurrence.

The stable Collector ID remains the synchronization key. If stronger evidence changes the suggested prompt or card kind, the next export updates the same Anki note.
