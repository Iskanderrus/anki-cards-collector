# ACCP-021: Batch backfill review and import workflow

## Goal

Make staged backfill usable with tens of candidates and complete the visible-material-to-normal-corpus workflow.

## Implementation status

Implemented by PR #70 through the existing ACCP-019/020 boundaries.

- `src/sidepanel/staged-review.tsx` provides a dedicated compact Staged view with text/disposition filtering, visible-scope New / More-evidence bulk selection, individual selection, keyboard navigation, evidence inspection, and explicit destructive discard confirmation;
- staged evidence editing changes only observed text, language, or context, preserves candidate/source identity, and reclassifies against the current corpus before commit;
- `src/background.ts` serializes staged edit/discard/commit operations with the existing MV3 staged-batch lock and mirrors successful transient mutations back to `chrome.storage.session`;
- selected import calls only `BatchCapturePipeline.commit()`; ACCP-019 revalidates against current corpus state immediately before the single repository transaction;
- exact already-represented evidence is consumed as a no-op, while actual evidence mutations create/add occurrences and force any affected Ready or Archived lexical unit back to Inbox;
- commit summaries are based on the actual post-transaction lexical-unit identities, so multiple new contexts that collapse onto one newly created lexical unit report one new unit plus added evidence rather than over-counting;
- if the corpus transaction fails, staged evidence remains available for retry; if the corpus transaction succeeds but the transient staged snapshot cannot be updated, the corpus is not rolled back and a stale reconstructed snapshot fails safe by reclassifying committed evidence as already represented;
- Staged review exposes no direct Anki export action.

Automated browser acceptance covers 50+ mixed-disposition candidates, long Hebrew/Serbian/Spanish content, filtering/bulk scope, evidence edits, no-op import, ambiguous-owner resolution, injected commit failure/retry, discard, keyboard flow, accessibility, and the Duolingo -> Staged -> Inbox -> ordinary review -> ACCP-018 mapped fake-Anki path.

Final closure still requires the real-account acceptance in `docs/manual-accp021-real-workflow-acceptance.md`.


## Dependencies

- ACCP-019;
- ACCP-020 for the Duolingo source;
- ACCP-011 for the final sidebar information architecture.

Full original Duolingo-to-existing-Anki acceptance also depends on ACCP-018.

## Sidebar structure

Add a dedicated **Staged** / **Backfill review** view separate from the normal lexical-unit queue.

This prevents temporary extraction results from looking like already accepted corpus items.

## Candidate row

Compact row should show:

- selection checkbox/state;
- observed text;
- language;
- short context preview;
- source/session;
- disposition badge:
  - New
  - Existing
  - More evidence
  - Needs review

Long sentences must remain usable.

## Filters and bulk actions

Support:

- filter by disposition;
- filter/search by text;
- select all visible New candidates;
- select repeated-evidence candidates;
- clear selection;
- accept selected;
- discard/ignore selected.

Avoid a dangerous single "Import all and mark Ready" action.

## Candidate edit

Before commit the user may correct:

- observed text;
- language;
- context when extraction was noisy.

Canonicalization remains a later normal-corpus review concern.

## Commit result

After accepting candidates, show a summary such as:

```text
12 new lexical units
7 occurrences added to existing units
3 skipped
2 need manual collision review
```

Imported units enter normal Inbox/review state.

They do not bypass the normal learning-card policy.

## Original motivating workflow

With ACCP-018 configured:

```text
Duolingo Hebrew visible review
  -> backfill session
  -> staged candidate review
  -> corpus commit
  -> normal lexical review
  -> Hebrew export profile
  -> existing Hebrew Anki note type
```

This is the end-to-end acceptance scenario for the original use case.

## Accessibility/keyboard

A 50+ candidate list must support:

- predictable tab/focus order;
- keyboard selection;
- bulk operations without requiring precise pointer use;
- screen-reader labels for disposition and selected state.

## Tests

- 50+ candidates;
- mixed dispositions;
- bulk select/filter;
- edit then commit;
- cancel/discard;
- partial commit error;
- long Hebrew/Serbian/Spanish strings;
- keyboard-only flow;
- axe checks.

## Manual acceptance

After ACCP-018 is available, use a real existing Hebrew Anki profile and confirm that accepted Duolingo-visible material can ultimately be exported with the user's existing note type without duplicate notes or source-specific export logic.
