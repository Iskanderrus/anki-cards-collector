# ACCP-020: Duolingo visible lesson backfill

## Goal

Use the ACCP-019 staging pipeline to collect useful language evidence from Duolingo material that is actually rendered to the user.

## Implementation status

Implemented as a specialized visible-DOM extractor plus an explicitly activated content-script session.

- one-shot scan injects the existing on-demand content script, reads only rendered lesson/review nodes, and immediately hands the evidence to ACCP-019 staging;
- session mode starts only after the user clicks **Start backfill session**;
- the session uses a temporary `MutationObserver` in that tab to accumulate newly rendered visible evidence while the user navigates manually;
- observation is supported only while recognizable lesson/review/challenge study DOM is present, not merely while the tab remains on a Duolingo hostname;
- same-document SPA navigation that removes the supported study context terminates the observer and hands the accumulated session evidence to ACCP-019 staging before the live session is discarded;
- explicit **Stop & stage session** uses the same staging semantics;
- page teardown makes the same preservation handoff on a best-effort basis before the content context disappears;
- no persistent manifest content script or required Duolingo host permission is added;
- Duolingo is declared only in `optional_host_permissions`;
- the first explicit scan/session activation asks Chrome for Duolingo page access;
- granting page access does not start background collection: extraction still runs only for a one-shot scan or an explicitly active session;
- staged evidence is not a LexicalUnit, is not Ready, and is not exported to Anki;
- the staged batch is mirrored in versioned `chrome.storage.session` so MV3 service-worker suspension cannot erase it;
- worker revival reconstructs the in-memory pipeline by rerunning `stageBatch()` against the current corpus, so dispositions are recalculated rather than persisted as stale classifications;
- session storage remains transient and is not part of IndexedDB backups or Anki export.

The side panel exposes the minimal ACCP-020 controls plus two read-only evidence views for acceptance/debugging:

- **Live session evidence** mirrors the active content-script buffer while a backfill session is running.
- **Staged evidence** shows evidence already handed to ACCP-019.

Stopping a session clears the live view and moves the accumulated evidence through ACCP-019 staging. Neither preview can edit, accept, or commit candidates. Full staged-candidate review/edit/bulk import remains ACCP-021.

## Dependencies

- ACCP-019.

## Modes

### One-shot scan

The user triggers **Scan visible lesson**.

Collector inspects the currently rendered DOM once, emits candidate evidence, and stops.

### Explicit backfill session

The user triggers **Start backfill session**.

Collector installs a temporary observer/content-script session scoped to the active Duolingo tab.

As the user manually moves through review/lesson material, Collector may inspect newly rendered visible DOM and accumulate new candidate evidence.

The user can stop the session at any time.

The session also stops when:

- the tab navigates away from supported Duolingo context;
- extension context is torn down;
- the session expires according to a conservative implementation timeout if one is needed.

Automatic termination is not cancellation: evidence already accumulated in the session must be preserved and staged through ACCP-019 exactly as with an explicit stop.

## Extraction rules

Prefer visible target-language material associated with lesson/review/challenge containers.

Each candidate should include:

- observed text;
- nearby visible context;
- Duolingo source metadata;
- capture/session timestamp.

Filter obvious UI chrome where reliable.

Candidate safety rules:
- normalize the full candidate text before enforcing the 240-character lexical-candidate limit;
- reject over-limit candidate nodes rather than truncating aggregate wrappers into lexical items;
- when a configured language is known, require matching `lang` metadata on the candidate or an ancestor; undeclared explicit-selector nodes are ignored rather than assumed to be target-language;
- evidence keeps the language assigned when it was observed; later Settings changes must not relabel an active session's accumulated evidence.

Context must remain target-language evidence, not a concatenation of the whole challenge UI:
- sentence/phrase candidates use their own visible target text as context;
- word/token candidates inherit the nearest clean target-language sentence when one is identifiable;
- otherwise fall back to the candidate text itself rather than prompt text, answer choices, or controls.

Do not attempt semantic translation or lemma inference in the source adapter.

## DOM strategy

Keep selectors isolated in the Duolingo adapter and fixture tests.

A broken specialized selector should degrade to safer generic visible-text behavior or an empty result, not broad page scraping.

Avoid depending on obfuscated/private internal application state.

## Matching-pairs handling

Matching-pairs exercises can render keyboard shortcut numbers in an outer `[lang]` wrapper around the actual target word. Generic language-marked DOM therefore uses a leaf-only fallback:

- explicit sentence/token/story selectors run first;
- generic `[lang]` elements are considered only when they do not contain another useful target-language `[lang]` descendant;
- wrapper shortcut numbers are never stripped heuristically from text, because digits may be legitimate study content;
- isolated matching-pair vocabulary keeps the clean target word itself as context unless a reliable target-language sentence exists.

## Session dedupe

Within one active session:

- avoid re-emitting the same visible candidate repeatedly as React re-renders;
- preserve distinct useful contexts when the same expression appears in meaningfully different lesson contexts;
- hand normalized evidence to ACCP-019 for corpus-level comparison.

## Security/privacy boundary

Must not:

- read cookies;
- access credentials;
- inspect authentication tokens;
- intercept/fetch private endpoints;
- automate exercise answers;
- click or advance the lesson;
- create persistent all-sites page observers.

The session is explicit, local, temporary, and limited to visible content.

The optional Duolingo origin permission may remain granted after the first approval, as Chrome permissions normally do. That permission only allows on-demand script injection; it does not install a persistent content script or start collection automatically.

## Tests

Use deterministic HTML/DOM fixtures for:

- challenge text;
- sentence containers;
- DOM replacement/re-render;
- repeated text;
- irrelevant navigation/UI labels;
- undeclared source-language text beside declared target-language material;
- over-limit target-language wrappers;
- session start/stop;
- same-document SPA navigation away from supported study context, including proof that a candidate unique to that session survives in the staged batch;
- changing the configured language while a session is active;
- actual extension service-worker termination/restart after staging, verifying staged evidence survives while corpus data remains unchanged;
- no-candidate page.

Browser E2E should verify the observer only runs after explicit activation.

## Manual acceptance

On a real completed/review Duolingo flow:

- run one-shot scan;
- run explicit session mode while manually reviewing material;
- confirm staged candidates correspond to visible study content;
- confirm no automatic navigation/exercise completion occurs;
- confirm generic selection capture still works.
