# Collector brand assets

## Status

Implemented by ACCP-010.

Collector uses the maintainer-supplied multi-card tray artwork as the canonical extension mark.

## Icon decision

The extension package uses the same multi-card mark at 16, 32, 48, and 128 pixels.

Both supplied concepts were reviewed at small sizes. The single-card version is visually simpler and remains a good candidate for a future favicon or similarly constrained surface, but the current Chromium extension keeps one canonical source mark so the toolbar, extension-management view, and larger package surfaces remain unmistakably the same product.

## Repository layout

```text
assets/brand/source/
  collector-multi.png

scripts/generate-brand-icons.mjs
dist/icons/                       # generated during build
```

The repository keeps a normalized 128×128 PNG source mark for extension-scale generation. Runtime/store-package derivatives are generated during every build rather than maintained as hand-edited copies.

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

Store screenshots should be refreshed after the sidebar redesign so ACCP-010 does not publish screenshots of an obsolete UI.
