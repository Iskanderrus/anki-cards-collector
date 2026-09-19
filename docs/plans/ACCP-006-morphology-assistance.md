# ACCP-006: Optional morphology and canonical-form assistance

## Goal

Offer language-aware canonical-form suggestions without making an external provider or model the source of truth.

## Dependencies

- ACCP-003.
- ACCP-004.

## Boundary

Assistance produces a suggestion, never a silent identity mutation.

Suggested result should contain:

- proposed canonical form;
- language;
- confidence/category where available;
- provider-neutral evidence/label suitable for UI.

The user accepts or rejects it.

Approval uses the same canonicalization/merge rules as manual edits.

## Provider architecture

Define a small provider interface so implementations can be:

- local language rules;
- optional installed library/service;
- future external provider.

Core capture/review/export must work when no provider exists.

Tests use deterministic fakes and no network.

## Data policy

Do not persist opaque provider reasoning as corpus truth.

Persist only user-approved corpus state. Optional short provenance such as “canonical form suggested” may be UI telemetry/local history if later required, but is not part of lexical identity.

## Failure behavior

- unsupported language -> no suggestion;
- ambiguous result -> show choices/uncertainty;
- provider unavailable -> normal manual workflow continues;
- provider result never overwrites observed surface text.

## Non-goals

- automatic translation;
- auto-accepting lemma changes;
- provider-specific storage schema.
