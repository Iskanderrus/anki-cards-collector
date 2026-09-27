# Learning-card policy v2

The Collector treats captures as observed evidence, not finished flashcards.

A canonical `LexicalUnit` owns one or more observed `Occurrence` records. The learning layer deterministically selects one authoritative occurrence and derives at most one study proposal from that local evidence. No proposal is persisted.

## Invariants

ACCP-005 keeps these constraints explicit:

- at most one proposal per lexical unit;
- deterministic and explainable decisions;
- no automatic translation, definition, morphology generation, LLM, API semantics, or probabilistic scoring;
- repeated occurrences strengthen/select evidence but do not multiply cards;
- canonical identity and observed surface form remain distinct;
- `LexicalUnit.id` remains the Collector/Anki synchronization identity;
- the same derived study payload drives review, export preview, TSV, and Anki;
- `ready` is approval of the current effective study payload, not permanent approval of a lexical-unit ID.

## One authoritative derivation path

`deriveLearningStudyContent(item)` is the learning/export boundary.

It returns:

- the policy proposal;
- the selected occurrence;
- semantic export values for `Prompt`, `Answer`, `CardKind`, `Why`, `Canonical`, `Observed`, `Context`, `Note`, and `Source`.

Review, export preview, TSV serialization, mapped user-owned models, and Collector-managed Anki notes consume this derivation instead of independently choosing a different occurrence/card kind.

Merge/split identity previews also read the selected occurrence from the same derivation.

## Occurrence selection

Occurrence quality remains the ACCP-002 local deterministic scorer.

It considers:

- whether the observed surface form appears in context;
- useful words remaining around the target;
- context on one or both sides;
- bounded context length;
- obvious URL/punctuation/symbol noise;
- contextual-blank usability when chunk/sentence retrieval is being considered.

Recency contributes no quality points. It breaks equal-quality ties; occurrence ID is the final stable tie-break.

The detail view shows the selected observed form, selected context, selection number/count, and the score explanation.

## Learning-value layer

ACCP-007 adds a separate derived decision above this card-content policy.

`deriveLearningStudyContent()` still answers **what card could be made**. `deriveLearningValueDecision()` answers **whether the current evidence should cause or maintain study burden**.

The learning-value layer has four explicit outcomes:

- **Study** — first/current useful evidence supports one study item;
- **Improve** — stronger/newly usable evidence materially improves that item;
- **Evidence only** — retain the encounter without increasing study burden because effective study content is unchanged;
- **Archive for now** — current ACCP-005 content is not studyable enough to recommend a card.

The decision reuses ACCP-002 occurrence quality and the ACCP-005 effective study-content signature. It does not define another occurrence scorer or another card renderer.

Recommendation is derived, not persisted. It never changes `LexicalUnit.id`, export bindings, Anki note identity, or status automatically. Ready and Archive remain explicit human workflow actions, and ACCP-005 remains the fail-closed gate for whether Ready can be approved at all.

An equivalent repeated occurrence may therefore produce:

```text
recommendation = Evidence only
status         = Ready
```

when the user already approved the unchanged study content. A stronger occurrence that changes effective study content keeps the existing ACCP-005 behavior: Ready returns to Inbox, while ACCP-007 explains the event as Improve.

## Policy-v2 decision table

| Unit | Evidence | Decision |
| --- | --- | --- |
| word | learner note | recognition; note is the explicit answer |
| word | useful clean selected context, no note | recognition; context is labelled as observed evidence, not a meaning |
| word | weak/noisy/empty selected context, no note | non-recommended; add a note or capture clearer context |
| chunk | strong usable selected context | contextual production |
| chunk | weak context + learner note | safer recognition fallback |
| chunk | weak context + no note | non-recommended; improve context or add a note |
| sentence | bounded contextual target | contextual recall |
| sentence | no bounded target + learner note | sentence review |
| sentence | no bounded target + no note | non-recommended; narrow target or add a note |
| any | canonical target > 25 words or > 180 characters | non-recommended as overly broad |

A strong chunk production occurrence must contain the observed target, support a blank with at least four residual context words, stay within the bounded context window, and avoid the deterministic noise penalty.

Sentence recall is deliberately stricter: the canonical target must also be at most twelve words and have useful context on both sides. Length alone never creates a sentence retrieval task.

## Canonical and observed forms

The selected observed surface drives contextual retrieval. The canonical form remains lexical identity.

Example:

```text
Canonical: tener ganas de
Observed:  tengo ganas de
Context:   Hoy tengo ganas de salir a caminar por el centro.

Prompt:    Hoy […] salir a caminar por el centro.
Answer:    tengo ganas de
           Canonical: tener ganas de
```

The lexical unit is not renamed to make the prompt easier to render.

## Strong and weak chunk examples

Strong context:

```text
Canonical: tener ganas de
Observed:  tengo ganas de
Context:   Hoy tengo ganas de salir a caminar por el centro.
Decision:  context-production
```

Weak context:

```text
Canonical: tener ganas de
Observed:  tengo ganas de
Context:   tengo ganas de
Decision:  not recommended without a learner note
Action:    capture a clearer surrounding sentence or add a learner note
```

Weak context never silently becomes a production card.

## Conservative sentence example

```text
Canonical/context: aunque llueva voy a caminar porque necesito aire
Learner note:      none

Decision: not recommended
Action:   narrow the canonical target or add an explicit learner note
```

The whole sentence appearing by itself is not evidence for a useful bounded retrieval task.

## Ready approval and invalidation

`ready` approves the effective exported study content.

The repository compares a deterministic study-content signature before and after content mutations. The signature covers recommendation state plus the effective exported fields:

```text
Prompt
Answer
CardKind
Why
Canonical
Observed
Context
Note
Source
language
```

Capture, edit, and backup restore use this signature invariant.

If the signature changes, a previously Ready item returns to Inbox. Examples:

- learner-note edit changes `Answer`;
- canonical rename changes `Canonical` and possibly the card decision;
- selected observed/context edit changes the retrieval task;
- a newly captured stronger occurrence replaces the old selected evidence;
- restore changes the effective selected study payload.

If a signature-sensitive mutation does not change the study payload, approval is preserved. For example, an equivalent repeated occurrence may win a recency tie while producing exactly the same exported fields; occurrence count/timestamp alone does not invalidate Ready.

Explicit merge and split retain the stricter ACCP-004 identity-operation boundary: a merge result returns to Inbox, and both split identities are Inbox. Those deliberate identity changes require review again even when the currently selected study payload is textually unchanged.

## Review/export parity

The side-panel review and export pipeline share the same derived semantic values.

The export preview stores the reviewed study-content signature and displays the reviewed Prompt, Answer, CardKind, Observed form, Context, and Note. On Export, Collector recomputes the current signature and fails closed if any previewed item changed or stopped being Ready.

This prevents a race where the user reviews one card but exports a newly derived card after stronger evidence or an edit arrives.

TSV performs only its established cell serialization (tabs/newlines become spaces). Anki receives the unflattened semantic values. Both originate from the same derivation.

## Proposal explanations

Policy outcomes carry deterministic decision/warning codes plus actionable human text.

The review layer can answer:

- why this card kind was chosen;
- which occurrence was selected and why;
- why an item is not recommended;
- what the learner can change to make it useful.

The occurrence scorer remains numeric and transparent; the card policy does not add opaque probabilistic scoring.

## Persistence and identity

Proposals and signatures are derived state and are not stored in IndexedDB or backup schema.

ADR 0005 therefore remains unchanged. ACCP-004 merge/split identity semantics also remain unchanged: `LexicalUnit.id` is primary identity, and user-owned Anki models/templates/CSS and routing semantics are untouched.
