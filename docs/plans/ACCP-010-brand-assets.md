# ACCP-010: Brand assets

## Status

Implemented.

## Goal

Adopt the supplied Collector artwork as the extension identity with deterministic, validated icon generation.

## Implemented decisions

- use the supplied multi-card tray artwork as the canonical extension mark;
- keep one normalized 128×128 PNG source master in the repository;
- generate 16, 32, 48, and 128px manifest/action icons deterministically at build time;
- keep source artwork separate from generated `dist/icons`;
- validate icon dimensions in normal and store-package checks;
- include 32px in the top-level manifest icon set for consistency.

The supplied single-card concept remains a documented future favicon/small-surface alternative; no favicon surface exists in the current extension package.

## Non-goals

- sidebar redesign;
- store screenshot refresh before ACCP-011;
- broad visual design system;
- animation.
