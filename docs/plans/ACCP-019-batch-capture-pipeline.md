# ACCP-019: Staged batch-capture pipeline

## Goal

Add a source-agnostic pipeline for extracting many candidate items without immediately mutating the main corpus.

## Implementation status

Implemented in `src/capture/batch.ts` and the repository batch boundary.

The initial staging lifetime is intentionally in-memory rather than persisted. This keeps staged evidence outside IndexedDB, backup/restore, and normal review state until the user explicitly commits it.

Current classification semantics are:

- **new** — no canonical or observed-form owner exists;
- **already-represented** — the same normalized surface/context/source evidence already exists;
- **repeated-evidence** — one existing lexical unit owns the canonical/observed form, but this context is new;
- **needs-review** — the candidate resolves to multiple possible lexical-unit owners.

Candidate IDs are stable within a caller-supplied batch/session identity and first-seen order. Exact in-batch duplicates collapse while distinct contexts remain separate evidence.

Selected mutations are committed by `CaptureRepository.captureBatch()` in one Dexie transaction. An ambiguous candidate requires an explicit matching lexical-unit resolution; transaction failure leaves both the corpus mutation set and staged batch unchanged.

## Dependencies

- Current lexical-unit / occurrence repository.
- Can be developed in parallel with Anki discovery and best-occurrence work.

## Domain types

Introduce a temporary candidate model similar to:

```text
BatchCaptureCandidate
  id
  surfaceText
  context
  language
  source
  capturedAt
  adapterMetadata?
```

and a derived comparison state:

```text
CandidateDisposition
  new
  already-represented
  repeated-evidence
  needs-review
```

The exact representation should stay independent from React and source-specific DOM types.

## Staging lifetime

Initial implementation may keep the active staging set in extension-local state/storage.

Requirements:

- staged candidates are distinguishable from the persistent corpus;
- accidental panel reload should not create corpus data;
- explicit discard clears staged candidates;
- source/session identity can group a batch;
- backup format does not need to include transient candidates unless persistence is intentionally introduced later.

If staging is persisted across extension restarts, it must live in a separate table/store and have explicit cleanup semantics.

## Normalization and dedupe

Use existing text normalization rules.

Within one batch:

- exact duplicate observed candidates collapse deterministically while preserving useful occurrence/context evidence;
- candidates are compared to existing observed-form indexes;
- no morphology inference is performed here.

Against corpus:

- matching existing observed form can be classified as repeated evidence;
- matching canonical identity can be surfaced;
- ambiguous collisions remain reviewable rather than silently merged.

## Commit

Accepted candidates are committed through repository APIs, not direct IndexedDB writes from adapters.

Commit should be transactional where possible.

A candidate commit may:

- create a new lexical unit + occurrence;
- append an occurrence to an existing lexical unit;
- require explicit user choice for an ambiguous collision.

Commit never marks the resulting unit Ready automatically.

## API boundary

Source adapters return candidate evidence.

They do not:

- call repository mutation directly;
- invoke the card policy;
- export to Anki.

## Tests

Cover:

- 50+ candidates;
- duplicates within one batch;
- repeated evidence against corpus;
- mixed new/existing candidates;
- partial selection;
- discard;
- commit rollback/failure;
- stable candidate IDs/order;
- manual single-selection capture regression.

## Acceptance

A fake batch source can produce a large candidate set, the user/test can accept a subset, and only the accepted evidence enters the normal corpus with existing invariants intact.
