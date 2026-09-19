# ACCP-010: Brand assets

## Status

Implemented.

## Goal

Adopt the supplied Collector artwork as the extension identity without sacrificing tiny-icon readability.

## Implemented decisions

- retain two maintainer-supplied marks as normalized source assets;
- use the single-card mark at 16px and 32px;
- use the multi-card mark at 48px and 128px;
- generate manifest/action icons deterministically at build time;
- keep source artwork separate from generated `dist/icons`;
- validate icon dimensions in normal and store-package checks;
- include 32px in the top-level manifest icon set for consistency.

## Small-size result

Visual comparison showed that the single-card version remains cleaner at toolbar/favicon scale. The multi-card version better communicates “collection/deck” once enough pixels are available to distinguish the card stack.

## Non-goals

- sidebar redesign;
- store screenshot refresh before ACCP-011;
- broad visual design system;
- animation.
