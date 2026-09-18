# Release and Chrome Web Store checklist

The repository produces a validated **ZIP upload package**. The Chrome Web Store handles signing and distribution after upload; no signing key belongs in this repository.

## Build the store package locally

Requirements:

- Node.js 22+
- the system `zip` command

Run:

```bash
npm install
npm run package:store
```

The command:

1. builds a release bundle without source maps;
2. validates manifest metadata, permissions, host permissions, icons, and production-only boundaries;
3. creates `release/anki-cards-collector-<version>.zip` with `manifest.json` at the archive root;
4. creates a matching `.sha256` checksum.

The package script normalizes file timestamps and feeds a sorted file list to `zip -X` so repeated builds from the same sources are stable.

## CI artifacts

Every pull request and push to `main` runs the normal code checks, real Chromium E2E tests, and store-package build.

The browser job produces a synthetic 640x400 listing screenshot at:

```text
artifacts/store/screenshot-1.png
```

The package job uploads the ZIP and SHA-256 file as a GitHub Actions artifact.

No real study corpus is used for the screenshot.

## Listing assets

Repository assets:

- `public/icons/icon128.png` — store/install icon;
- `public/icons/icon48.png` — extension-management icon;
- `public/icons/icon16.png` and `icon32.png` — extension/action icons;
- `store-assets/promo-small.png` — 440x280 small promotional image;
- CI `store-screenshot` artifact — 640x400 screenshot of the real extension UI using synthetic content.

Chrome Web Store guidance currently accepts 1280x800 or 640x400 screenshots and requires at least one screenshot. Keep screenshots representative of the current release.

## Dashboard steps that remain manual

Before the first submission:

1. enable 2-step verification on the Google developer account;
2. create/finish the Chrome Web Store developer account;
3. create the item in the Developer Dashboard;
4. complete the **Store listing** fields using `docs/store-listing.md`;
5. complete the **Privacy** tab consistently with `docs/privacy.md`;
6. upload the 128x128 icon, at least one generated screenshot, and the small promo tile;
7. upload the validated ZIP from `release/`;
8. resolve any pre-submission installation/validation findings;
9. review visibility/distribution and submit for review.

The repository deliberately does not contain a publisher ID, OAuth client secret, refresh token, access token, or other Chrome Web Store credentials.

## Versioning and GitHub releases

`package.json` and `public/manifest.json` must have the same version. `npm run check:store` enforces this.

After merging the release changes:

1. bump both versions;
2. run `npm run package:store`;
3. tag the commit as `v<version>`;
4. push the tag.

The `Release` workflow verifies that the tag matches the manifest version, rebuilds the store package, and creates a GitHub Release containing the ZIP and SHA-256 checksum.

## References

- Chrome Web Store preparation: https://developer.chrome.com/docs/webstore/prepare
- Listing guidance: https://developer.chrome.com/docs/webstore/best-listing
- Chrome Web Store API / publishing prerequisites: https://developer.chrome.com/docs/webstore/using-api
