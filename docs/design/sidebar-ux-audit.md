# Sidebar UX audit

## Current problem

The current sidebar exposes almost every detail for every collected item at once. That is acceptable with two or three short words, but it breaks down quickly with longer phrases, sentences, repeated occurrences, export diagnostics, and several pending items.

The narrow side panel is the constraint that should drive the design.

The current UI has four recurring problems:

1. **Low information density.** Every item renders as a large card even when the user only needs to scan the queue.
2. **Weak hierarchy.** Target text, context, policy explanation, source, status, and actions compete for attention.
3. **Poor long-text behavior.** Ten-word targets or long contexts turn the panel into a wall of text.
4. **Too many equal-weight actions.** Edit, status changes, export state, archive, and delete are visible too often and with too little hierarchy.

ACCP-011 owns the implementation.

## Target information architecture

The sidebar should use a master-detail pattern adapted to a narrow single-column surface.

### Queue view

The default view is a compact list of lexical units.

Each row should show only the information needed to decide what to open:

- canonical text;
- language;
- state;
- occurrence count;
- compact export destination/profile indicator;
- optional one-line context preview.

Long canonical text should wrap or clamp predictably. A row must remain usable for a phrase or sentence rather than assuming a one-word target.

### Detail view

Opening one item reveals the information needed for a decision:

- canonical form;
- observed forms;
- selected/best occurrence;
- learner note;
- card proposal;
- export destination;
- source;
- review actions.

Only one item should need to be fully expanded at a time.

### Settings view

Global settings should not consume a large permanent block above the queue. Settings should move behind a dedicated settings affordance/view.

Advanced export-profile and note-type mapping configuration belongs there, not in every queue row.

## Progressive disclosure

The default surface should show less.

Details such as:

- policy explanation;
- all occurrences;
- source URL;
- raw export diagnostics;
- destructive actions;

should be available when needed but not dominate the normal review flow.

## Long targets and contexts

### Queue

- canonical text: one or two lines;
- context preview: one line;
- metadata: compact secondary line;
- no full generated answer in the list.

### Detail

- full wrapping;
- selected occurrence shown first;
- additional occurrences collapsed behind a count;
- explicit canonical vs observed distinction;
- no fixed-height control that clips meaningful text.

## Action hierarchy

The primary action depends on state.

### Inbox

Primary: review/approve.

Secondary: edit.

Low-frequency: archive.

Destructive: delete, behind a deliberate affordance.

### Ready

Primary: keep ready / export context.

Secondary: edit or return to Inbox.

### Exported

Primary: update/sync status.

Secondary: edit.

A batch-level export action remains separate from item-level review.

## Keyboard and accessibility

The redesign must preserve keyboard-first operation.

Expected baseline:

- queue navigation without a mouse;
- open focused item;
- return to queue;
- status actions;
- edit;
- no shortcut handling while typing;
- visible focus;
- screen-reader labels that describe item state and destination.

The exact shortcuts may evolve, but the capability must remain.

## Destination visibility

Once ACCP-013 exists, a compact row should make destination obvious without requiring settings inspection.

Example:

```text
שלום
he · 2 occurrences · Hebrew RU
Ready
```

This prevents a multilingual user from exporting to the wrong deck without turning every row into a settings form.

## Success criteria

The redesign is successful when:

- 20+ queued items are still scannable;
- a 10+ word target remains readable;
- only the selected item exposes full detail;
- current keyboard and accessibility guarantees survive;
- export destination is visible but not visually dominant.
