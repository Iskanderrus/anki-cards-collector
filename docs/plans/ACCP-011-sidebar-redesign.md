# ACCP-011: Sidebar redesign

## Goal

Replace the current repeated full-card feed with a compact queue and focused detail flow.

## Dependencies

- ACCP-013 should define the destination/profile model before final UI wiring.
- ACCP-002 can proceed in parallel and its selected-occurrence output should be shown in detail.

## Structure

Create explicit sidebar views/state:

- Queue
- Item detail/review
- Settings
- optional onboarding entry point

Do not render all proposal detail for every queued item.

## Queue row

Show:

- canonical text, clamped/wrapped;
- language;
- status;
- occurrence count;
- export profile/destination;
- optional short context preview.

Row click/keyboard opens detail.

## Detail

Show:

- canonical/observed relationship;
- selected occurrence and other occurrences;
- learner note;
- proposed card;
- destination/profile;
- export status;
- primary and secondary actions.

Rare/destructive actions are visually separated.

## Keyboard

Preserve keyboard-first use:

- next/previous row;
- open detail;
- back to queue;
- edit;
- Ready/Inbox/Archive;
- no shortcut interception while typing.

## Implementation steps

1. Split current monolithic sidepanel component into view/components.
2. Add route/view state without introducing a full web-router dependency unless needed.
3. Move settings into its own view.
4. Build compact queue.
5. Build focused detail.
6. Port edit/status/export outcomes.
7. Integrate destination/profile badge from ACCP-013.
8. Update CSS for long text and responsive side-panel width.
9. Rewrite browser E2E and axe assertions.

## Acceptance

Matches ADR 0007 and issue ACCP-011.
