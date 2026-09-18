# Release and browser-store checklist

The repository can build and validate the extension package without a browser-store account. Publisher-account upload, review, and store signing remain external steps.

## Build a release package

```bash
npm install
npm run check
npm run package
```

`npm run package` creates a release-mode extension and writes:

```text
release/anki-cards-collector-<version>.zip
```

Release mode omits JavaScript source maps. The packaging script validates that:

- `package.json` and `manifest.json` have the same version;
- a Git tag such as `v0.1.0`, when present, matches that version;
- no `.map` files are packaged;
- the four production icon sizes are present;
- the manifest has no persistent content script;
- host permissions remain limited to localhost AnkiConnect;
- ZIP entries are added in stable path order with fixed timestamps.

That makes the archive construction deterministic for a given built `dist/` tree. Dependency installation is currently performed with `npm install`; it is not claimed to be a bit-for-bit reproducible dependency build until a dependency lockfile is committed.

## GitHub release workflow

`.github/workflows/release.yml` can be run manually or from a `v*` tag.

A tagged run validates the project, builds the release ZIP, uploads it as a workflow artifact, and attaches it to a GitHub Release. It does **not** submit to a browser store or use publisher credentials.

## Store assets

The extension ships PNG icons at 16, 32, 48, and 128 pixels.

The Chromium E2E suite also saves `artifacts/sidepanel-store-preview.png`. The screenshot is generated entirely from synthetic test language on a local fixture page; it contains no personal study corpus or private browsing data.

Treat the generated screenshot as a reproducible starting asset. Store-specific cropping or additional screenshots can be prepared from the same synthetic fixture.

## Permission rationale

The public manifest intentionally keeps permissions narrow:

- `activeTab` — temporary access to the page after an explicit user action;
- `scripting` — injects the capture script on demand instead of installing an all-sites content script;
- `contextMenus` — provides **Collect for Anki** for an explicit selection;
- `sidePanel` — hosts review, editing, backup/restore, and export UI;
- `storage` — stores local settings;
- localhost host access — talks only to AnkiConnect at `127.0.0.1:8765` or `localhost:8765`.

There is no `<all_urls>` permission and no persistent content script.

## Privacy disclosure checklist

Before a store submission, the listing/privacy disclosure should match the implemented behavior:

- collected expressions, contexts, review state, and Anki IDs stay in IndexedDB;
- settings stay in `chrome.storage.local`;
- no analytics, telemetry, account service, or application backend is used;
- page capture occurs only after an explicit user action;
- source URLs are filtered before persistence according to the visible retention setting;
- JSON backup/restore is local and is not uploaded;
- direct Anki export goes only to the user's local AnkiConnect service.

See [privacy.md](privacy.md) for the detailed boundary.

## Publisher-account step

The final store step cannot be performed from this public repository alone. A publisher account must:

1. download or build the validated ZIP;
2. upload it to the browser-store dashboard;
3. provide the current listing text, screenshots, privacy disclosures, and required declarations;
4. complete the store's review/signing/publishing flow.

No store credentials or signing secrets should be committed to this repository.
