# Collector brand assets

The source mark in this directory is a normalized PNG master derived from the multi-card tray artwork supplied by the project maintainer.

- `source/collector-multi.png` — primary extension mark: tray with a stack of cards.

Extension icon derivatives are generated at build time by `scripts/generate-brand-icons.mjs`. Generated files are not treated as source artwork.

The multi-card mark is used consistently at 16, 32, 48, and 128px. The supplied single-card artwork remains a useful future favicon/small-surface alternative, but the current extension package deliberately keeps one canonical source asset so every generated size comes from the same brand master.
