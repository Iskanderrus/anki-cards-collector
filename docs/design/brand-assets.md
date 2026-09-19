# Collector brand assets

## Decision

Collector will use the maintainer-supplied tray-and-card artwork as its visual identity.

- **Primary mark:** the multi-card tray artwork.
- **Small-size fallback:** the simpler single-card tray artwork when it reads more clearly at tiny sizes.
- **Favicon:** prefer the single-card mark unless size tests show the multi-card mark remains legible.

The implementation issue is ACCP-010.

## Why

The current placeholder icon does not communicate the product well. The supplied artwork already conveys the three ideas that matter most: collecting, cards, and selecting something worth keeping.

A browser toolbar icon has different constraints from a README hero image or store artwork. The icon system therefore needs size-specific validation instead of assuming one source image works everywhere.

## Asset policy

Source artwork and generated derivatives should be kept separate.

Recommended repository layout:

```text
assets/brand/source/
assets/brand/generated/
public/icons/
```

Source artwork should remain lossless. Generated manifest icons should be reproducible from the source files.

The implementation should generate and validate at least the common extension sizes used by Chromium manifests:

- 16×16
- 32×32
- 48×48
- 128×128

Store-listing artwork can use a larger derivative without replacing the source.

## Small-size test

Before choosing which mark is used at 16px/32px, compare both artworks at actual toolbar scale.

The test should answer:

- does the tray silhouette remain visible?
- is the star still recognizable?
- do the stacked cards become visual noise?
- does the icon remain distinct in both light and dark browser chrome?

The simpler single-card mark is the default fallback if the multi-card version loses clarity.

## Accessibility and consistency

The brand asset must not carry information that is unavailable elsewhere in the UI. It is identification, not status.

The same primary mark should be used consistently in:

- extension management UI;
- toolbar;
- documentation;
- store listing;
- any future product page.

No implementation change is included in this document.
