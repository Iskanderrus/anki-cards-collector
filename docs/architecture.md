# Architecture

This page describes the current extension and the boundaries that keep it understandable.

## Runtime pieces

### Side panel

The React side panel is the product surface. It shows the local corpus, review state, settings, fallback exports, and Anki export.

It talks to IndexedDB through `CaptureRepository` rather than reaching into Dexie tables everywhere. The repository is intentionally small; the boundary matters more than the amount of code behind it.

### Background service worker

The service worker owns browser-level coordination:

- creates the selection context menu;
- injects the capture script only after a user action;
- asks the active page for the current selection;
- saves the result;
- opens / refreshes the side-panel workflow.

It is not a crawler and does not maintain a hidden browsing session.

### On-demand content script

There is no persistent `<all_urls>` content script.

When capture is requested, Chrome injects `content.js` into the active tab. The script reads only:

- the selected text;
- nearby visible text used as context;
- page title and URL.

The adapter decides how to find useful visible context. It never receives cookies, storage, credentials, or network responses.

### Source adapters

`SourceAdapter` isolates page-specific DOM knowledge.

`GenericWebAdapter` is the fallback and therefore the most important implementation. `DuolingoAdapter` only improves context selection for visible Duolingo challenge markup. If Duolingo changes its DOM, generic capture still works.

That is deliberate: the extension should not depend on one external site's private implementation.

### Staged batch capture

`BatchCapturePipeline` is the source-agnostic boundary for opt-in backfill and other multi-item imports.

A batch source adapter returns visible evidence only. The pipeline normalizes and deduplicates that evidence, compares it with the current corpus, and classifies each candidate as new, already represented, repeated evidence, or needing review. Persisted evidence identity is based on language + normalized surface + normalized context + source; adapter-only metadata does not split candidates because the current occurrence model does not persist it. Staged candidates are not IndexedDB entities and are not included in backups.

Because the Manifest V3 background worker may be suspended at any time, lifecycle-critical transient state is mirrored in versioned `chrome.storage.session` records. The staged batch stores only batch identity + staged evidence; the live Duolingo session stores only its owning `tabId + sessionId`. Both remain outside the corpus/backup/export model. On worker revival, staged classifications are recomputed against the current repository and the recorded live-session owner is validated by messaging that exact tab/session before it is trusted.

Only an explicit commit crosses the persistence boundary. Selected candidates are converted back into normal capture drafts and passed to `CaptureRepository.captureBatch()`, which applies the same lexical-unit/occurrence rules inside one Dexie transaction. A unique exact persisted occurrence is already represented even when the same surface form is owned elsewhere; unresolved surface ambiguity still requires an explicit existing lexical-unit target before commit. A batch commit never marks a unit `ready`.

Manual single-selection capture remains independent from this staging path.

### Staged review and import

ACCP-021 keeps review orchestration above the ACCP-019 domain boundary rather than teaching React or source adapters how to mutate the corpus.

The side panel receives the current transient `BatchCaptureResult` from the extension service worker. Search, disposition filters, visible-scope selection, and candidate inspection are UI state only. Evidence corrections are sent back through the service worker, where the existing staged-batch lock serializes edit/discard/commit operations and persists the updated reconstruction payload to `chrome.storage.session`.

A selected import never calls Anki. It asks `BatchCapturePipeline.commit()` to reclassify the selected candidate IDs against the current corpus and then uses the existing transactional `CaptureRepository.captureBatch()` boundary. Any lexical unit that actually receives accepted batch evidence is returned to `inbox` when necessary, including units that were previously `ready` or `archived`; exact already-represented no-ops do not mutate the corpus or status.

Commit summaries are derived from the actual repository result rather than the pre-commit disposition labels. This matters when two staged `new` contexts collapse onto the same newly created lexical unit: the result is one new lexical unit plus one added occurrence.

The corpus transaction and transient staged snapshot have different durability. If the corpus transaction fails, the staged batch remains intact for retry. If the corpus transaction succeeds but updating `chrome.storage.session` fails, Collector never attempts to undo the successful corpus transaction. A later service-worker reconstruction may temporarily resurrect the stale staged evidence, but reclassification turns already committed exact evidence into safe no-ops before any subsequent commit.

The dedicated Staged view intentionally has no direct Anki export action. Accepted evidence must first enter the normal corpus and complete ordinary review/card policy before it can become Ready and follow the normal routed export path.


### Persistence

IndexedDB contains three persistent entities. Learning content remains separate from operational Anki destination state.

```text
LexicalUnit
  id
  contentKey = language + normalized canonical text
  canonicalText
  normalizedCanonicalText
  language
  review status
  optional Anki note id

Occurrence
  id
  lexicalUnitId
  surfaceText
  normalizedSurfaceText
  context
  source metadata
  capturedAt

ExportBinding
  lexicalUnitId
  profileId
  state = override | reserved | exported
  optional Anki note id
  deck/model snapshot
  updatedAt
```

`ExportProfile` and language-route configuration live in extension settings; the per-item binding lives in IndexedDB so changing defaults cannot silently reinterpret an already-exported note.

A new capture either creates a lexical unit or attaches another occurrence to an existing one. Once a unit has been canonicalized, a repeated capture of an already-observed surface form can still find that unit through the occurrence index.

The unique `contentKey` belongs to the canonical form. Surface-form identity belongs to occurrences. Manual canonicalization can consolidate compatible local units; if both candidates already point to different Anki notes, consolidation is refused rather than guessing which external identity should survive.

### Learning-card policy

The persistent corpus is not the exported card format.

The review layer derives one deterministic proposal from each `CollectedItem`. It classifies the canonical target, uses the latest observed surface form to build a contextual retrieval prompt when possible, and refuses to invent semantic information that is not already present in the corpus or learner note.

The proposal is intentionally not stored. Editing the source material recomputes it immediately, while `LexicalUnit.id` remains stable.

`ready` means the user approved the current proposal for export.

See [learning-card policy](learning-card-policy.md).

### Read-only Anki deck evidence

`DeckAnalysisService` sits above the AnkiConnect client as a read-only evidence boundary.

A selected deck is inspected in two stages:

1. `findCards` returns matching card IDs;
2. only a deterministic bounded sample (24 by default) is passed to `cardsInfo`.

The service aggregates model counts only within that inspected sample and keeps representative rendered cards per sampled model/card ordinal. It never converts frequency into a model choice. Missing/malformed cards are treated as unavailable sample evidence, which also makes races with cards changing in Anki safe.

Representative HTML/CSS stays local. The side-panel preview uses a sandboxed iframe with external resource loading disabled. No deck-analysis path owns or calls mutation actions.

### Anki boundary

`AnkiClient` is the only code that knows the AnkiConnect protocol.

Export first resolves an `ExportProfile` for each Ready item:

1. existing per-item binding/override;
2. language route;
3. fallback profile.

Ready items are grouped by their **resolved destination identity** (profile ID + resolved deck + resolved model + ownership mode), not merely by profile ID. This keeps an older pinned snapshot separate from the current definition of the same profile. Before the first Anki mutation for an unbound item, Collector persists a `reserved` destination binding containing the profile plus deck/model snapshot. A successful export upgrades it to `exported` and fills the Anki note ID. If the final local write fails or the network outcome is uncertain, the `reserved` state becomes an **external identity lock**: the destination cannot be cleared or rerouted, the lexical unit cannot be deleted, and canonical consolidation cannot replace its Collector ID until a retry reconciles it against Anki. Repository methods enforce those transitions directly; UI guards are only an additional convenience layer. This prevents a cross-system partial failure from losing or re-keying a possibly existing Anki note identity. Later route or profile-default changes therefore do not silently reinterpret or move that note.

For a Collector-managed profile, the Anki upsert path is:

1. verify the destination deck exists; no export path creates a missing deck implicitly;
2. make sure the Collector-owned note type contains the proposal fields;
3. derive the same reviewed prompt/answer shown in the side panel;
4. use the binding's Anki note ID when possible;
5. if needed, recover an existing note by `CollectorID`;
6. update it or create it;
7. persist the returned note ID and destination snapshot in the binding.

Changing an exported item's deck is a separate explicit operation. ACCP-013 permits that move only when the note type remains the same; note-type changes wait for ACCP-014 compatibility/mapping validation. The move is compensating: if Anki moves successfully but the new local binding cannot be saved, Collector attempts to move the note back to the original deck and reports a hard divergence if even that rollback fails.

User-owned note types are not treated as Collector-managed. Profile ownership parsing is fail-closed: missing or unknown mode values are rejected rather than upgraded to mutating ownership. Even a syntactically `collector-managed` profile may enter schema mutation only when its model identity is the recognized Collector-owned `Collector Basic`. User-owned models can be inspected by the live catalog, but export through them is blocked until ACCP-014 supplies explicit field mapping. Collector does not add fields or rewrite templates/CSS merely because such a model exists.

The Collector ID is intentionally a first-class field of the Collector-managed model. Human-readable text can change; identity should not.

## Dependency direction

The useful rule is:

```text
browser/UI -> application repository + clients -> domain types
                                      |
                                      -> IndexedDB / AnkiConnect
```

DOM adapters know nothing about storage. Storage knows nothing about Chrome. The Anki client knows nothing about page capture.

For a project this size, that is enough architecture. Adding a DI framework or distributed service boundary would create ceremony without buying clearer ownership.

## Failure behaviour

The collector assumes partial failure is normal.

- No selection: return a useful message and write nothing.
- Restricted browser page: Chrome rejects injection; the side panel reports the capture failure.
- Duplicate expression: keep the lexical unit and add an occurrence.
- Anki is closed: local data stays untouched and TSV remains available.
- An Anki note was deleted externally: the next export falls back to lookup / create while retaining the resolved profile.
- A configured deck disappears: export fails usefully instead of silently recreating it. The side panel may create the saved deck only through an explicit user action after a live catalog refresh.
- A profile or language route changes: already-exported notes keep their pinned binding snapshot until the user performs an explicit move.
- A local note-ID write or export response is uncertain after Anki mutation: the binding remains `reserved`; destination changes, deletion, binding clearing, and ID-changing consolidation are blocked until retry/reconciliation.
- Backup/settings data contains an unknown export-profile ownership mode: restore/settings normalization fails closed before any Anki schema mutation.
- A source adapter stops matching: generic capture remains available.
