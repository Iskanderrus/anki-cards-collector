# ACCP-020: Duolingo visible lesson backfill

## Goal

Use the ACCP-019 staging pipeline to collect useful language evidence from Duolingo material that is actually rendered to the user.

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

## Extraction rules

Prefer visible target-language material associated with lesson/review/challenge containers.

Each candidate should include:

- observed text;
- nearby visible context;
- Duolingo source metadata;
- capture/session timestamp.

Filter obvious UI chrome where reliable.

Do not attempt semantic translation or lemma inference in the source adapter.

## DOM strategy

Keep selectors isolated in the Duolingo adapter and fixture tests.

A broken specialized selector should degrade to safer generic visible-text behavior or an empty result, not broad page scraping.

Avoid depending on obfuscated/private internal application state.

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

## Tests

Use deterministic HTML/DOM fixtures for:

- challenge text;
- sentence containers;
- DOM replacement/re-render;
- repeated text;
- irrelevant navigation/UI labels;
- session start/stop;
- navigation away;
- no-candidate page.

Browser E2E should verify the observer only runs after explicit activation.

## Manual acceptance

On a real completed/review Duolingo flow:

- run one-shot scan;
- run explicit session mode while manually reviewing material;
- confirm staged candidates correspond to visible study content;
- confirm no automatic navigation/exercise completion occurs;
- confirm generic selection capture still works.
