# ADR 0007: Use a compact queue and focused detail view in the sidebar

**Status:** Accepted

## Context

The current side panel renders a large detailed card for every collected item. That works for a tiny test corpus but degrades quickly with long phrases, sentence targets, multiple occurrences, export diagnostics, and a realistic review queue.

A Chromium side panel is narrow. Treating it like a wide dashboard produces poor information density and weak hierarchy.

Several planned features also need a stable place in the interface:

- best-occurrence selection;
- canonicalization;
- export-profile destination;
- field-mapping diagnostics;
- merge/split actions.

Adding each of those to the current repeated-card layout would make the problem worse.

## Decision

The side panel will use a master-detail interaction model optimized for a narrow single-column surface.

The default view is a compact queue of lexical units. Opening one item shows its focused detail/review view.

Queue rows contain only summary information needed for navigation and triage:

- canonical text;
- language;
- status;
- occurrence count;
- compact destination/profile indicator;
- optional short context preview.

Detailed content is progressively disclosed in the focused item view.

Settings move out of the permanent queue header into a dedicated settings view.

Keyboard-first navigation and accessibility remain first-class requirements.

## Consequences

Long targets remain usable without expanding every item.

Future review features have a predictable home instead of adding more repeated controls to every row.

The redesign requires browser E2E and accessibility updates because navigation structure changes substantially.

The UI may later adapt to a wider two-pane layout, but the baseline contract is a single-column queue/detail flow that remains usable at normal side-panel width.
