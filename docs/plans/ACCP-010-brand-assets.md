# ACCP-010: Brand assets

## Goal

Adopt the supplied Collector artwork as the extension identity without sacrificing tiny-icon readability.

## Dependencies

None. This can be implemented independently.

## Plan

1. Add the two maintainer-supplied source artworks to a clearly named source-asset directory.
2. Record which source is the multi-card primary mark and which is the single-card fallback.
3. Create a deterministic resize/export script.
4. Generate 16, 32, 48, and 128px manifest icons.
5. Compare both marks at 16/32px in actual browser chrome.
6. Use the multi-card mark by default; switch tiny sizes to the single-card mark if it is materially clearer.
7. Update manifest/package/store references.
8. Add lightweight validation that required icon files exist and have expected dimensions.
9. Update documentation/store screenshots only after the sidebar redesign if screenshots would otherwise become stale.

## Tests

- packaging contains required icons;
- manifest points to existing files;
- generated dimensions are correct;
- no source asset is overwritten by generated output.

## Non-goals

- sidebar redesign;
- broad visual design system;
- animation.
