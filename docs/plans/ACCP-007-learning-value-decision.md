# ACCP-007: Learning-value decision

## Goal

Decide whether local evidence should create/maintain study burden, improve an existing proposal, remain corpus evidence only, or be recommended for no card for now.

This layer is deliberately separate from lexical identity (ACCP-004) and study-content construction (ACCP-005):

```text
lexical identity
    ↓
learning-value recommendation
    ↓
study-content/card policy
```

## Current-state audit

The repository already owns the inputs needed for a local deterministic recommendation:

- `LexicalUnit.id` and occurrence ownership define lexical identity;
- ACCP-002 selects the authoritative occurrence and exposes deterministic quality;
- ACCP-005 `deriveLearningStudyContent()` decides whether useful study content can be formed;
- `learningStudyContentSignature()` defines the effective-content/Ready invalidation boundary;
- normal capture already preserves Ready/Archived when that signature is unchanged and returns changed study content to Inbox;
- explicit merge and split already return affected identities to Inbox;
- Ready and Archive are explicit user actions;
- export bindings and Anki identity remain keyed by lexical-unit identity.

No new persistent recommendation or override state is required. Backup v4 and IndexedDB schema remain unchanged.

## Pure decision boundary

`deriveLearningValueDecision()` is the authoritative ACCP-007 boundary.

Inputs are the persisted local `CollectedItem` only. ACCP-007 is corpus-relative, not event-relative.

The current ACCP-002-selected occurrence is compared with a deterministic counterfactual corpus formed by removing that selected occurrence and deriving ACCP-005 again from the remaining persisted occurrences. This asks whether the current best evidence is equivalent to, stronger than, or merely different from the other studyable evidence already present in the same lexical unit.

`capturedAt` remains source chronology and participates only in ACCP-002's documented deterministic selection tie-break. ACCP-007 never interprets it, UUID order, or side-panel session state as ingestion/mutation order.

Because the recommendation is computed from the same persisted corpus snapshot on every load, closing/reopening the side panel or restarting the browser cannot change the result unless learning-relevant persisted corpus state changed.

The function does not use:

- wall-clock-dependent rules;
- network/provider output;
- hidden ML or numeric learning-value scores;
- Anki scheduling/ease/difficulty;
- learner mastery or forgetting estimates;
- cross-user data.

The current accepted corpus state is authoritative. Unaccepted ACCP-006 suggestions never enter this boundary.

## Decision table

| Condition | Recommendation | Reason semantics |
| --- | --- | --- |
| current ACCP-005 proposal is non-recommended | **Archive for now** | current corpus does not support a useful study card |
| current proposal is useful and has no studyable alternative occurrence | **Study** | current corpus supports one useful study card |
| removing the selected occurrence leaves the same ACCP-005 effective signature | **Evidence only** | equivalent persisted evidence already supports the same study card |
| selected occurrence has strictly higher ACCP-002 quality than the other studyable evidence | **Improve** | the selected evidence is materially stronger than the other studyable evidence in this corpus |
| alternative study content exists but is different without a strict quality improvement | **Study** | useful study content exists, but no deterministic improvement claim is justified |

Occurrence count by itself never creates a new card or an Improve recommendation.

The fallback `Study` rule is deliberate: different content is not labelled “Improve” unless the current selected occurrence is strictly stronger than the other studyable evidence.

## Repeated evidence

An exact/equivalent repeat stays attached to the same lexical unit. If removing the selected occurrence leaves an alternative corpus with the same ACCP-005 effective signature, ACCP-007 returns `evidence-only`.

That outcome:

- retains the occurrence history;
- retains lexical identity;
- preserves an existing Ready approval when ACCP-005 says effective content is unchanged;
- does not create a second proposal or Anki identity;
- does not archive the lexical unit.

## Better evidence

When the current ACCP-002 selected occurrence has strictly higher quality than the other independently studyable occurrence in the persisted corpus, the recommendation is `improve`.

Existing ACCP-005 invalidation remains authoritative: if the effective study signature changed, a previously Ready item returns to Inbox and must be explicitly approved again.

## Learner notes and other mutations

Learner notes are part of current persisted corpus state. They may make ACCP-005 study content usable, but ACCP-007 does not infer note history or call a note change an improvement merely because a prior value is no longer available.

ACCP-007 does not invent semantic value for the note. It observes only the resulting ACCP-005 state.

Canonical edits, accepted ACCP-006 suggestions, merge, split, and restore recompute from the resulting accepted corpus state. Identity mutation rules remain owned by ACCP-004.

## Human override and status

Recommendation and workflow status are different concepts.

```text
recommendation = derived guidance
status         = explicit user workflow state
```

No new persisted override field is introduced.

Existing actions are the override:

- `Study` does not automatically mark Ready; the user may instead Archive;
- `Evidence only` does not revoke an already-approved Ready item and the user may explicitly choose Ready for an Inbox item;
- `Archive for now` does not automatically archive anything;
- Ready remains gated by ACCP-005 studyability.

The recommendation is never written back merely to mirror status.

## Review UI

Focused review shows a compact **Learning value** section containing:

- the recommendation label;
- one bounded user-facing reason;
- an explicit reminder that Ready and Archive remain user choices.

The compact queue remains unchanged and capture remains interruption-free.

Keyboard Ready/Archive/Inbox shortcuts keep their existing behavior and are exercised together with recommendation overrides in browser E2E.

## Export and Anki identity

ACCP-007 does not add an export filter or Anki lifecycle operation.

Export remains:

```text
explicit Ready
→ ACCP-005 current study content
→ ACCP-013 routing
→ profile/live validation
→ existing idempotent Anki upsert
```

One lexical unit retains one Collector/Anki identity. Recommendation changes never create a second note, move a note, or delete a note.

## Persistence and backup

```text
recommendation: derived
new schema:     none
backup change:  none
```

Equivalent restored corpus state derives the same decision and reason. The classifier has no side-panel/session baseline: the same persisted lexical unit, notes, and occurrence set produce the same recommendation after side-panel/browser recreation. Workflow-only status changes do not affect the recommendation.

## Tests

Coverage includes:

- useful word/chunk/sentence corpus;
- weak ACCP-005 content;
- learner-note-supported current corpus;
- exact/equivalent repeat;
- Evidence only stability after side-panel/browser recreation;
- stronger selected evidence against the other studyable evidence;
- delayed staged import whose stronger evidence has an older `capturedAt`;
- same-timestamp multi-evidence staged commit without UUID-as-mutation-order behavior;
- Study fallback when the alternative evidence is not independently studyable;
- equal-quality but materially different evidence remaining Study;
- workflow-status independence;
- stable lexical/Anki identity;
- same-canonical independent identities;
- split-style independent occurrence subsets;
- merge-style survivor recomputation;
- deterministic restore-equivalent state;
- focused-review Study / Evidence only / Improve / Archive UI;
- keyboard Study → Archive and Evidence only → Ready overrides;
- existing ACCP-005 Ready invalidation and export parity regressions.

## Non-goals

- Anki scheduling or mastery estimation;
- spaced-repetition replacement;
- translation/definitions/generated examples;
- hidden ML/LLM ranking;
- morphology acceptance;
- automatic merge/split;
- automatic Ready/Archive;
- Anki-note deletion or duplicate-card creation.
