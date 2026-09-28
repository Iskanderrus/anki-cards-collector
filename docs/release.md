# Release and Chrome Web Store checklist

The repository produces a validated deterministic **ZIP upload package**. Chrome Web Store handles signing/distribution after upload; no signing key or publisher credential belongs in this repository.

## Current release status

Phase 1 feature work is complete. ACCP-025 is the final release/distribution gate.

During Tranche A the truthful status is:

> Phase 1 release candidate; Chrome Web Store publication pending final accepted RC.

Do not create a tag, GitHub Release, or canonical Chrome Web Store submission from an unmerged implementation branch.

## Pinned release toolchain

- Node.js 22.23.3
- npm 11.6.0

Canonical release preparation uses:

```bash
npm ci
npm run package:store
```

`npm ci` is mandatory for verification/release packaging so `package.json` / lockfile drift fails closed.

## What package:store does

The command:

1. builds a release bundle with production runtime semantics and no source maps;
2. validates manifest metadata, permissions, host permissions, generated icons, production-only runtime boundaries, and the strict store-file allowlist;
3. creates `release/anki-cards-collector-<version>.zip` with `manifest.json` at archive root;
4. creates the matching `.sha256` checksum.

The deterministic ZIP writer uses source-defined fixed timestamps and file modes and marks filenames as UTF-8 in both local and central headers. Host mtimes, umask, and `SOURCE_DATE_EPOCH` do not control archive bytes.

The reproducibility gate builds independent workspaces plus adversarial packaging conditions and requires byte-identical ZIP SHA-256 hashes.

## Package allowlist

The current store package contains exactly:

```text
background.js
content.js
icons/icon16.png
icons/icon32.png
icons/icon48.png
icons/icon128.png
manifest.json
sidepanel.html
sidepanel.js
styles.css
```

Store validation rejects source maps, `.ts`/`.tsx` sources, E2E fixture signatures, synthetic provider fixtures, and React/ReactDOM/Scheduler development runtimes.

Required host permissions remain limited to localhost AnkiConnect. Duolingo origins remain optional host permissions.

## Asset truth

The committed brand source is:

```text
assets/brand/source/collector-multi.png
```

The build does **not** copy icon PNGs from `public/icons/`. It generates the package icons during build into:

```text
dist/icons/icon16.png
dist/icons/icon32.png
dist/icons/icon48.png
dist/icons/icon128.png
```

The Chrome Web Store promotional asset is kept separately under `store-assets/`.

CI generates a synthetic screenshot from the real Chromium extension flow as the `store-screenshot` artifact. The current output is 640x400 and must remain representative of the release UI; no real study corpus may be used.

Chrome's current listing guidance requires at least one screenshot and accepts 1280x800 or 640x400 images. Prefer the larger size only when it improves legibility; screenshots must depict the current user experience.

## Exact release-candidate gate

Before merge/tag/publication, freeze one exact ACCP-025 Tranche A head and record:

```text
RC_SHA
RC_TREE
BUILD_A_SHA256
BUILD_B_SHA256
BUILD_C_SHA256
PACKAGE_SIZE
PACKAGE_FILES
```

All reproducibility hashes must match.

Inspect the **actual candidate ZIP** for Manifest V3, version, permission/host boundaries, optional Duolingo origins, package allowlist, absence of source/test/development artifacts, CRC integrity, UTF-8 flags, and deterministic metadata.

That exact accepted ZIP is the one that must later be rebuilt by the Release workflow and submitted to Chrome Web Store. A checksum mismatch blocks publication.

## Bounded real acceptance

Use the exact frozen candidate head, production build, synthetic study material, a clean disposable Chromium profile, real Anki Desktop + AnkiConnect, and disposable Anki notes/decks where needed.

Acceptance covers:

- clean onboarding and reopen-introduction persistence;
- mapped existing user-owned Anki profile setup;
- Hebrew and Serbian routes, with Spanish spot-check as appropriate;
- ordinary visible capture -> Inbox -> explicit Ready -> preview -> real Anki;
- repeat export to the same Anki note identity;
- stronger evidence returning Ready -> Inbox and requiring reapproval before same-note update;
- deleted-note recovery;
- one bounded explicit visible-DOM Duolingo staged sample where the external site permits it;
- staged reconstruction across extension/service-worker recreation;
- backup v4 restore and committed-success semantics;
- Anki-offline actionable retry;
- unchanged user-owned field schema/templates/CSS and untouched unmapped fields.

Missing material evidence is not PASS. A genuine external limitation is recorded as `BLOCKED_EXTERNAL`.

## Version and GitHub Release

Current `package.json` and `public/manifest.json` version is `0.1.0`.

There has been no prior public Phase 1 GitHub Release, so the intended first tag remains:

```text
v0.1.0
```

Do **not** bump to `0.1.1` merely because this is the first tag.

After independent review and master merge:

1. verify canonical `main` has the exact accepted tree;
2. rebuild/reverify the package;
3. tag that exact canonical commit as `v0.1.0`;
4. push the tag.

The existing `Release` workflow then:

- checks out the tag;
- installs Node 22.23.3 and npm 11.6.0;
- runs `npm ci`;
- runs `npm audit --audit-level=high`;
- verifies tag == manifest version;
- runs `npm run package:store`;
- creates the GitHub Release with the ZIP + checksum.

The resulting Release ZIP SHA-256 must equal the accepted reproducible candidate SHA-256.

## Chrome Web Store publication

Upload the exact accepted GitHub Release/store ZIP.

Complete the Developer Dashboard:

1. Store listing fields from `docs/store-listing.md`;
2. Privacy practices/declarations consistent with `docs/privacy.md`;
3. current icon/screenshots/promotional assets;
4. distribution/visibility;
5. pre-submission validation;
6. submission/review/publication.

The repository deliberately contains no publisher ID, OAuth client secret, refresh token, access token, or other Chrome Web Store credential.

If an authenticated publisher path is unavailable from the execution environment, report:

```text
CHROME_WEB_STORE_PUBLICATION=BLOCKED_EXTERNAL
```

and hand the human publisher the exact accepted ZIP/checksum plus the dashboard steps. Do not claim Phase 1 complete until the listing is actually installable.

## Post-publication README update

Once the listing is public/installable, update README's primary **Install** section to the real Chrome Web Store URL.

Keep **Build from source / Developer Mode** as a secondary developer/evaluator workflow.

If necessary, make one tiny post-publication metadata/link PR under issue #80; do not change runtime code.

## PR #68

PR #68 is stale against the completed Phase 1 product. Do not merge it as-is.

Close/supersede it once current public truth is merged or the final publication-metadata pass is ready. Preserve any useful commercialization concept only in a later explicitly authorized roadmap.

## References

- Chrome Web Store preparation: https://developer.chrome.com/docs/webstore/prepare
- Store listing: https://developer.chrome.com/docs/webstore/cws-dashboard-listing
- Listing images: https://developer.chrome.com/docs/webstore/images
- Distribution: https://developer.chrome.com/docs/webstore/cws-dashboard-distribution
- Program/listing requirements: https://developer.chrome.com/docs/webstore/program-policies/listing-requirements
