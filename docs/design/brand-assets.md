# Collector brand assets

## Status

Implemented by ACCP-010.

Collector uses the maintainer-supplied tray-and-card artwork as its visual identity.

## Size-aware icon decision

Two related marks are retained because a browser toolbar icon has very different constraints from a store/documentation image.

- **Primary mark:** multi-card tray.
- **Small-size mark:** single-card tray.
- **16px / 32px:** single-card mark.
- **48px / 128px:** multi-card mark.
- **Future favicon:** use the single-card mark at favicon sizes.

Side-by-side inspection at 16, 32, 48, and 128 pixels showed that the stacked-card detail adds visual noise at the smallest sizes while becoming useful brand information from 48px upward.

## Repository layout

```text
assets/brand/source/
  collector-multi.png
  collector-single.png

scripts/generate-brand-icons.mjs
dist/icons/                       # generated during build
```

The repository keeps normalized 128×128 PNG source marks for extension-scale generation. Runtime/store-package derivatives are generated during every build and are not maintained as a second hand-edited source set.

## Generation

```bash
npm run icons:generate
```

Normal `npm run build`, E2E builds, and release builds generate the same icon variants automatically.

The generator is dependency-free Node.js and performs deterministic PNG decoding, alpha-aware bilinear resizing, and PNG encoding.

Generated sizes:

- 16×16
- 32×32
- 48×48
- 128×128

## Validation

`npm run check` verifies the generated production icons exist and match the dimensions declared in the manifest.

`npm run package:store` applies the same dimensional checks to the release package.

## Accessibility and consistency

The icon is product identification, not status; no user-visible state is conveyed only through the mark.

The same multi-card identity should be used for larger documentation/store surfaces. Store screenshots themselves should be refreshed after the sidebar redesign so ACCP-010 does not publish screenshots of an obsolete UI.
