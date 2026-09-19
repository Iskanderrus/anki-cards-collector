# Collector brand assets

The source marks in this directory are normalized PNG masters derived from the artwork supplied by the project maintainer.

- `source/collector-multi.png` — primary mark: tray with a stack of cards.
- `source/collector-single.png` — simplified mark used where the stacked-card detail becomes noisy.

Extension icon derivatives are generated at build time by `scripts/generate-brand-icons.mjs`. Generated files are not treated as source artwork.

Current size policy:

- 16px: single-card mark
- 32px: single-card mark
- 48px: multi-card mark
- 128px: multi-card mark

This split was chosen after side-by-side small-size inspection: the single-card mark is cleaner at toolbar/favicon scale, while the multi-card mark better communicates the Collector identity at larger sizes.
