# ADR 0011: Stage source backfill candidates before corpus mutation

**Status:** Accepted

## Context

Manual explicit selection is the safest baseline capture path, but it is inefficient when a learner revisits material already studied on a source such as Duolingo and wants to recover many useful words or phrases.

A source-specific backfill extractor can surface dozens of candidate items from one page or review session. Writing every extracted string directly into the Collector corpus would create several problems:

- noisy or duplicate candidates would become persistent study material immediately;
- source-specific heuristics would bypass normal lexical-unit and occurrence invariants;
- a source adapter would effectively decide what deserves a card;
- large batches would be difficult to review or undo;
- a brittle source adapter could pollute the corpus.

The source boundary must remain compatible with ADR 0002: source-specific logic can inspect visible page content, but it must not use private APIs, credentials, cookies, or network interception.

## Decision

Batch/backfill capture is a two-stage operation:

```text
visible source evidence
    ↓
temporary staged candidates
    ↓
human review / dedupe decision
    ↓
normal corpus commit
    ↓
normal review / Ready decision
    ↓
normal Anki export
```

A source adapter may produce a bounded set of **BatchCaptureCandidate** values containing observed text, visible context, source metadata, and optional adapter-specific confidence/classification.

Those candidates are temporary evidence. They are not LexicalUnits and they are not Anki cards.

Before commit, Collector compares staged candidates against the existing corpus and classifies them as:

- new candidate;
- already represented;
- repeated evidence for an existing lexical unit;
- ambiguous / needs manual review.

Only user-selected candidates are committed through the normal repository layer.

Committing staged evidence does not automatically mark the resulting lexical unit Ready.

Source adapters never invoke Anki export directly.

## Duolingo session mode

A Duolingo backfill session may observe visible DOM changes only after the user explicitly starts the session.

It may accumulate candidates while the user manually moves through a lesson or review.

It must stop when the user explicitly stops it, leaves the supported context, or the extension context ends.

It must not:

- answer exercises;
- click/advance lessons;
- read credentials/cookies/tokens;
- intercept network traffic;
- call private Duolingo APIs.

## Consequences

Manual one-selection capture remains unchanged and reliable.

Batch capture becomes reusable for other future visible-page or file-import sources without coupling persistence to Duolingo.

Backfill UI needs its own staged-candidate view rather than reusing the normal lexical-unit queue directly.

The original Duolingo-to-Anki workflow remains compatible with the general Collector pipeline: backfill only changes how evidence enters the corpus; review, card policy, routing, and Anki export stay shared.
