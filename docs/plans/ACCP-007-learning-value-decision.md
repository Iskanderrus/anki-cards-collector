# ACCP-007: Learning-value decision

## Goal

Decide whether new evidence warrants a new/updated study proposal or should remain corpus evidence only.

## Dependencies

- ACCP-002.
- ACCP-004.
- ACCP-005.

## Outcomes

A lexical unit/review event can produce one of four recommendations:

1. propose/keep a study card;
2. improve an existing proposal with better evidence;
3. keep as evidence only;
4. archive/no card for now.

The recommendation is deterministic and explainable. The user may override it.

## Inputs

Use only local known state in the first implementation:

- canonical identity;
- observed forms;
- occurrence count/history;
- selected occurrence quality;
- learner note;
- existing export state;
- current proposal state.

Do not infer learner memory strength from data Collector does not own.

## Implementation steps

1. Define a pure decision result type.
2. Add rules for first evidence vs repeated evidence vs improved context.
3. Integrate selected-occurrence quality.
4. Expose recommendation/reason in detail review.
5. Ensure evidence-only captures never create duplicate Anki notes.
6. Add override path.
7. Add fixtures for repeat/improve/archive cases.

## Non-goals

- replacing Anki scheduling;
- estimating mastery from review history;
- hidden machine-learning ranking.
