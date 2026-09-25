# ADR 0012: Lexical-unit ID is primary identity

**Status:** Accepted

## Context

Collector originally treated `language + normalized canonical text` (the derived `contentKey`) as a unique lexical identity. That made canonicalization-induced consolidation convenient, but it could not represent homographs, separate senses, or deliberate pedagogical splits that intentionally keep the same written form.

ACCP-004 also has to preserve established cross-system identity rules: occurrences have stable IDs, exported/reserved Anki state is keyed by lexical-unit ID, review approval is invalidated by changed study evidence, and ambiguous staged ownership must fail closed rather than guess.

The implementation audit found uniqueness assumptions in:

- the Dexie `&contentKey` index;
- single-capture direct-owner lookup;
- staged canonical-owner maps and transactional batch commit;
- ACCP-003 canonicalization preview/update consolidation;
- backup validation and restore conflict detection;
- tests and documentation that equated canonical equality with lexical identity.

## Decision

`LexicalUnit.id` is the only primary lexical identity.

`contentKey = normalized language + normalized canonical text` remains persisted, derived, searchable lookup data, but is non-unique. Two different lexical-unit IDs may intentionally have the same canonical text, language, and content key.

Canonical equality never proves identity equality. Editing a canonical form renames that lexical unit in place. Same-canonical units are shown as possible merge candidates; they are never consolidated implicitly.

Merge is an explicit identity-management operation with preview and confirmation. It preserves occurrence IDs, chooses a deterministic surviving lexical-unit ID, preserves the only durable/exported identity when exactly one side has one, and blocks incompatible or reserved Anki identity states. Study-relevant merge results return to Inbox.

Split is an explicit operation that moves a non-empty proper subset of occurrences to a new lexical-unit ID. Occurrence IDs are preserved. The original keeps its external Anki identity; the new unit starts unbound and in Inbox. The new unit may deliberately use the same canonical text as the source.

Ordinary capture and staged classification may use canonical/observed indexes for discovery, but multiple plausible owners are ambiguity. Collector must require explicit ownership resolution or fail closed rather than select the first owner or auto-merge.

Collector external identity continues to follow lexical-unit ID, not human-readable canonical text. Merge/split do not mutate Anki directly; normal Inbox → Ready → export flow performs any later synchronization.

## Persistence and compatibility

Dexie v5 changes `lexicalUnits.contentKey` from unique to non-unique without rewriting lexical-unit or occurrence IDs.

JSON backup v4 records the same entity shape as v3 but changes the format invariant so duplicate content keys are valid. Backup versions 1–3 remain importable. Restore identity matching is by lexical-unit ID and occurrence ID; same-canonical units are not a restore conflict.

## Consequences

- intentional homographs and sense splits are representable and durable;
- canonical edits no longer delete another lexical identity;
- merge/split are atomic, stale-preview-safe corpus operations;
- exported/reserved Anki identity remains lexical-ID-based;
- normal capture can become ambiguous after a deliberate split and must surface that ambiguity;
- later morphology or semantic assistance may suggest relationships, but cannot silently rewrite identity.
