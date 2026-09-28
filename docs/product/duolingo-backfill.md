# Duolingo visible-material backfill

## Goal

Support a common recovery workflow:

> Revisit language material already studied in Duolingo, collect useful visible words and phrases in bulk, deduplicate them, review them, and export the approved items through the learner's normal Anki profile.

The shipped Phase 1 implementation is provided by ACCP-019, ACCP-020, and ACCP-021.

## Current implementation

Collector supports explicit text selection on Duolingo through the visible-DOM source adapter. That remains the smallest everyday capture path.

Phase 1 also ships an opt-in visible-material backfill path without changing the privacy boundary. Candidates are staged first, reviewed/selected explicitly, then committed into the ordinary corpus before normal review and Ready authorization.

## Target workflow

```text
open completed/review material in Duolingo
        ↓
start visible backfill scan/session
        ↓
Collector observes only rendered DOM
        ↓
temporary candidate set
        ↓
dedupe/classify against existing corpus
        ↓
user selects useful candidates
        ↓
commit as normal lexical evidence
        ↓
normal review/card policy
        ↓
language/export profile
        ↓
existing Anki deck + note type
```

For example, with a configured Hebrew profile:

```text
Duolingo Hebrew review
        ↓
שלום
מה שלומך?
אני רוצה...
        ↓
staged candidate review
        ↓
accepted evidence
        ↓
he → Hebrew export profile
        ↓
existing Hebrew Anki deck/model
```

## Capture modes

Collector distinguishes three conceptually separate capture modes. The first two are implemented in Phase 1; the third remains outside the current release unless a future roadmap explicitly authorizes it.

### 1. Explicit selection

The user highlights one word, phrase, or sentence.

This remains the baseline for normal browsing.

### 2. Visible-page / visible-session backfill

The user explicitly asks Collector to inspect visible material.

Two sub-modes are implemented:

- one-shot scan of the currently rendered supported Duolingo study state;
- explicitly started/stopped session that accumulates candidates as the user manually moves through supported lesson/review material and new DOM becomes visible.

The session is not background browsing collection. It is scoped to an explicit user action and visible source material.

### 3. Explicit bulk import — not Phase 1

A later source could provide a legitimate file/list/export selected by the user. Phase 1 does not ship that product path.

If a future roadmap authorizes it, it should reuse the staged-candidate pipeline rather than inventing another persistence boundary.

## Candidate vs learning item

A candidate is not automatically a study card.

If `תודה` already exists in the corpus, the candidate may become another occurrence rather than another lexical unit.

If the candidate is noisy or ambiguous, the user can ignore it.

If accepted, it enters the normal corpus and still requires the normal review/Ready decision before Anki export.

## Source-specific extraction

The Duolingo adapter may use visible DOM structure to improve extraction.

It should prefer:

- target-language text visibly presented as lesson/review material;
- sentence or challenge containers that provide useful context;
- deduplicated observed forms within one active session.

It should avoid treating obvious navigation, UI labels, progress text, or unrelated chrome as language candidates.

Because source DOM changes over time, extractor failure must degrade safely rather than corrupting the corpus.

## Privacy and automation boundary

Backfill must not use:

- private Duolingo APIs;
- cookies/tokens/credentials;
- network interception;
- automated exercise completion;
- automated lesson navigation.

Rendered study content is processed locally.

## Relationship to Anki integration

Backfill does not know which Anki deck or card style to use.

After corpus review, normal export routing handles that through ACCP-013/014/016/017/018.

This separation keeps source extraction independent from Anki presentation and makes the same backfill pipeline usable with other sources.
