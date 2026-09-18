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

### Persistence

IndexedDB contains two primary entities.

```text
LexicalUnit
  id
  contentKey = language + normalized text
  displayText
  normalizedText
  language
  review status
  optional Anki note id

Occurrence
  id
  lexicalUnitId
  context
  source metadata
  capturedAt
```

A new capture either creates a lexical unit or attaches another occurrence to an existing one.

The unique `contentKey` is a local invariant. It gives the repository a simple idempotency boundary while still retaining repeated encounters.

### Learning-card policy

The persistent corpus is not the exported card format.

The review layer derives one deterministic proposal from each `CollectedItem`. It classifies the material, uses captured context to build a retrieval prompt when possible, and refuses to invent semantic information that is not already present in the corpus or learner note.

The proposal is intentionally not stored. Editing the source material recomputes it immediately, while `LexicalUnit.id` remains stable.

`ready` means the user approved the current proposal for export.

See [learning-card policy](learning-card-policy.md).

### Anki boundary

`AnkiClient` is the only code that knows the AnkiConnect protocol.

Export follows an upsert path:

1. make sure the target deck exists;
2. make sure the Collector note type contains the proposal fields;
3. derive the same reviewed prompt/answer shown in the side panel;
4. use the locally stored Anki note id when possible;
5. if needed, recover an existing note by `CollectorID`;
6. update it or create it;
7. persist the returned note id locally.

The Collector ID is intentionally a first-class Anki field. Human-readable text can change; identity should not.

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
- An Anki note was deleted externally: the next export falls back to lookup / create.
- A source adapter stops matching: generic capture remains available.
