# ACCP-006: Optional morphology and canonical-form assistance

## Status

Implemented on `accp-006-morphology-assistance`; merge remains gated by exact-head CI, focused product smoke, and independent full-snapshot review.

## Goal

Offer optional language-aware canonical-form suggestions during deliberate review without making a provider, model, or morphology library the source of corpus truth.

The approval boundary is:

```text
observed evidence
  -> optional provider request
  -> advisory suggestion
  -> explicit user choice
  -> existing canonical-edit domain path
```

Capture never invokes assistance automatically.

## Dependencies

Completed baseline:

- ACCP-003 — canonical edit preview/confirmation;
- ACCP-004 — lexical-unit ID is primary identity; same-canonical identities stay separate; Merge/Split are explicit;
- ACCP-005 — `deriveLearningStudyContent()` and study-content-signature Ready invalidation;
- ACCP-012 — deliberate focused Inbox review;
- ACCP-019/021/022 — staged ownership/reclassification remains independent of canonical assistance.

## Phase 0 findings

The authoritative mutation path is `CaptureRepository.update()`.

Before ACCP-006 it already:

- normalizes canonical text and language;
- preserves `LexicalUnit.id`;
- permits a canonical edit to equal another unit's canonical text without merging identities;
- mutates observed occurrence fields only when they are explicitly supplied;
- compares `learningStudyContentSignature()` before/after the edit and returns changed study content to Inbox;
- leaves export bindings keyed by lexical ID untouched.

`previewCanonicalization()` already provides same-canonical discovery and the manual-edit preview semantics. Explicit `mergeLexicalUnits()` remains a different operation.

ACCP-006 therefore does not introduce a second repository writer. Acceptance is:

```text
provider suggestion
  -> stale-state validation
  -> previewCanonicalization()
  -> CaptureRepository.update()
```

The assisted call supplies an expected `updatedAt` precondition. `update()` re-reads that value inside its Dexie transaction, so a provider result cannot overwrite a newer edit between preview and commit.

No schema migration is required.

## Provider-neutral boundary

`src/assistance/canonical-form.ts` owns provider-facing types and orchestration.

A provider receives only bounded advisory input:

- normalized language;
- observed surface form;
- current canonical form;
- optional bounded context.

The provider can return:

- no suggestion;
- one suggestion;
- multiple suggestions.

Provider payloads are validated and reduced to provider-neutral fields:

- proposed canonical;
- language;
- confidence category where meaningful;
- short category/evidence label.

Malformed values and provider exceptions fail closed as unavailable assistance. No opaque reasoning or provider response blob is persisted.

## Production provider

The production implementation is deliberately narrow and deterministic.

It currently supports a small explicit Spanish irregular-form lexicon (for example `tengo -> tener`, `estoy -> estar`) and preserves known ambiguity such as `fui -> ir | ser`.

It does **not** perform suffix stripping or pretend to be a general Spanish, Serbian, or Hebrew lemmatizer. Unknown Spanish forms return no suggestion. Other languages are normal unsupported cases and continue through manual review.

No network, model download, telemetry, API key, host permission, or provider secret is required.

The E2E build has a deterministic synthetic provider seam for delayed/failing/superseded-request browser journeys. That seam is selected only by the existing `COLLECTOR_E2E` build flag; release/production uses the conservative local provider.

## UI and user decision

Focused review contains a non-blocking **Canonical-form assistance** section.

States are explicit:

- idle;
- checking;
- no suggestion;
- one suggestion;
- ambiguous suggestions;
- unsupported language;
- unavailable/error.

Provider output is labelled as a suggestion, never as the current or correct canonical form.

For ambiguity, no option is preselected. The user must choose one deliberately.

Dismiss/reject is UI-only and performs no corpus write. Manual Edit remains available regardless of provider outcome.

Native buttons/radios provide keyboard operation and screen-reader state is announced with status semantics. Existing review shortcuts already ignore typing/native activation targets, so assistance controls do not trigger accidental Ready/Archive/navigation actions.

## Identity and corpus safety

Acceptance preserves the ACCP-004 invariants:

- the lexical ID does not change;
- observed evidence is not rewritten;
- export binding remains attached to the same lexical ID;
- equal canonical text does not imply merge;
- split siblings remain independent;
- explicit Merge remains the only merge operation.

Assistance UI/request ownership is keyed by lexical ID, never canonical text.

The request gate gives each request a sequence identity. A newer request supersedes the older one, and switching/editing the active unit invalidates visible assistance. Acceptance also revalidates the lexical ID, canonical/language assumptions, and exact `updatedAt` snapshot. A removed/merged-away identity or newer edit therefore fails closed.

## Ready and export parity

Acceptance reuses ACCP-005's study-content-signature invalidation. If the effective learning content changes, Ready returns to Inbox; dismissed suggestions do not affect status.

There is no assisted-only export field. After explicit re-approval, review, export preview, TSV, Collector-managed Anki, and mapped user-owned Anki all derive from the same `deriveLearningStudyContent()` result.

## Persistence and privacy

Provider request/result state is ephemeral React/request state.

Collector persists only the canonical corpus state the user explicitly accepted. There is:

- no provider provenance blob in `LexicalUnit`;
- no persistent provider cache;
- no new IndexedDB table/version;
- no remote upload;
- no broad permission change.

No ADR was added because ACCP-006 does not introduce a new persistent model, cache contract, or external service boundary. It applies the existing local-first and lexical-ID architecture.

## Verification coverage

Deterministic tests cover provider normalization, one/no/multiple suggestions, unsupported language, provider/capability exceptions, malformed output, bounded context, no pre-accept mutation, accepted mutation through the repository path, Ready invalidation, observed/ID/binding preservation, same-canonical separation, split isolation, stale edit/merge rejection, request supersession, and manual-edit fallback.

Parity coverage starts from an accepted suggestion and verifies the accepted canonical plus unchanged observed form across:

- review derivation;
- export preview;
- TSV;
- Collector-managed Anki fields;
- mapped user-owned Anki fields.

Chromium journeys cover one suggestion, dismiss, Ready invalidation, ambiguity with keyboard selection, provider unavailability, unsupported language, same-canonical separation, late-response isolation, request supersession, and axe accessibility.

## Non-goals

- ACCP-007 learning-value scoring;
- automatic canonicalization during capture;
- automatic translation/definition/example generation;
- generated meaning;
- multiple-card generation;
- automatic sense disambiguation;
- automatic merge/split;
- broad heuristic lemmatization;
- external-provider configuration;
- LLM chain-of-thought or provider-reasoning storage.
