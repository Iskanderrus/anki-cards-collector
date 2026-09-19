# ACCP-005: Learning-card policy v2

## Goal

Improve card proposals using canonical identity plus selected occurrence quality while keeping output deterministic and bounded.

## Dependencies

- ACCP-002.
- ACCP-003.
- ACCP-004 should preferably stabilize identity semantics first, although it is not required for initial policy tests.

## Policy boundary

The policy consumes:

- canonical lexical unit;
- selected observed occurrence;
- learner note;
- occurrence/evidence metadata.

It does not invent semantic meanings.

One proposal per lexical unit remains the default budget in this iteration.

## Card decisions

The policy should:

- prefer contextual production for useful chunks/constructions;
- use recognition when evidence does not support production;
- use sentence review conservatively;
- show canonical vs observed form consistently;
- reject poor candidates with actionable reasons.

The exact prompt shown in review must be the one exported.

## Implementation steps

1. Refactor proposal input around the ACCP-002 selected occurrence.
2. Define deterministic rules per lexical-unit kind.
3. Add explicit proposal/rejection reasons.
4. Keep user note as evidence rather than generated meaning.
5. Update Anki/TSV parity tests.
6. Update detail-view rendering after ACCP-011.
7. Document examples in `docs/learning-card-policy.md`.

## Tests

Table-driven fixtures should cover:

- isolated word with/without learner note;
- chunk with strong context;
- chunk with weak context;
- canonical form different from observed form;
- sentence target;
- repeated evidence.

## Non-goals

- multi-card explosion;
- automatic translation;
- probabilistic/opaque scoring.
