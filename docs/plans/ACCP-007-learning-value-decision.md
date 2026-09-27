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

Inputs are local corpus state only. Event-level comparisons require the real semantic before-state. The focused review surface retains the last loaded `CollectedItem` snapshot when a learning-relevant corpus mutation is observed and compares that exact snapshot with the reloaded item.

`capturedAt` is source chronology, not ingestion order. ACCP-007 never removes the "newest" occurrence to fabricate a before-state, and UUID ordering is never used as mutation chronology.

If no trustworthy before-state exists (for example, a cold/reopened side panel), ACCP-007 describes only the current snapshot: usable content is `Study`, non-studyable content is `Archive for now`. It does not claim `Evidence only` or `Improve` without an actual comparison boundary.

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
| current ACCP-005 proposal is non-recommended | **Archive for now** | current evidence does not support a useful study card |
| useful current snapshot with no trustworthy before-state | **Study** | current evidence supports one useful study card |
| explicit empty before-state → first usable evidence | **Study** | first useful evidence supports one review card |
| previous state was non-studyable and current state is usable | **Improve** | new evidence/user input makes useful study content possible |
| previous and current ACCP-005 effective study signatures are equal | **Evidence only** | evidence is retained but current study content is unchanged |
| selected occurrence changed and ACCP-002 quality strictly increased | **Improve** | stronger selected context materially improves the proposal |
| usable study content changed without a proven quality improvement | **Study** | the card remains useful but changed and requires review |

Occurrence count by itself never creates a new card or an Improve recommendation.

The fallback `Study` rule is deliberate: a changed payload is not labelled “Improve” unless the local deterministic evidence proves improvement.

## Repeated evidence

An exact/equivalent repeat stays attached to the same lexical unit. If the ACCP-005 effective signature is unchanged, ACCP-007 returns `evidence-only`.

That outcome:

- retains the occurrence history;
- retains lexical identity;
- preserves an existing Ready approval when ACCP-005 says effective content is unchanged;
- does not create a second proposal or Anki identity;
- does not archive the lexical unit.

## Better evidence

When newly captured evidence becomes the ACCP-002 selected occurrence, changes effective ACCP-005 study content, and has strictly higher occurrence quality, the recommendation is `improve`.

Existing ACCP-005 invalidation remains authoritative: if the effective study signature changed, a previously Ready item returns to Inbox and must be explicitly approved again.

## Learner notes and other mutations

For an explicit old-vs-new comparison, a learner-note change that turns a previously non-recommended ACCP-005 proposal into usable study content resolves to `improve`.

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

Equivalent restored corpus state derives the same snapshot decision and reason. Mutation explanations are intentionally ephemeral: a side-panel reload keeps the actual pre-mutation item in memory only while that review session remains open. Workflow-only status changes do not replace that baseline; a later learning-relevant mutation does.

## Tests

Coverage includes:

- cold/current useful word/chunk/sentence;
- explicit empty before-state → first useful evidence;
- weak ACCP-005 content;
- exact/equivalent repeat;
- occurrence-count-only repeat;
- stronger selected evidence;
- weak-to-usable old/new comparison through learner note;
- Ready + equivalent repeat;
- stable lexical/Anki identity;
- same-canonical independent identities;
- split-style independent occurrence subsets;
- merge-style survivor recomputation;
- deterministic restore-equivalent state;
- cross-identity comparison rejection, including non-studyable current content;
- delayed staged import whose stronger evidence has an older `capturedAt`;
- same-timestamp multi-evidence staged commit without UUID-as-chronology behavior;
- status-only reload preserving the last real mutation baseline;
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
