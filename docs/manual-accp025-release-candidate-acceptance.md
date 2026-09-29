# ACCP-025 release-candidate acceptance

This is the canonical bounded acceptance procedure for the final Phase 1 release candidate.

Use **one exact frozen commit**. Do not edit the candidate while collecting evidence. Record results outside the candidate tree (for example in the ACCP-025 PR conversation) so evidence recording does not change the SHA being accepted.

## Safety and environment

Required:

- exact frozen ACCP-025 candidate SHA;
- Node.js 22.23.3;
- npm 11.6.0;
- production build only;
- synthetic/non-private study material;
- clean disposable Chromium profile;
- real Anki Desktop + AnkiConnect;
- disposable destination notes/decks where destructive behavior must be exercised.

Do not use a personal/private study corpus in screenshots, logs, or published evidence.

A missing material gate is not PASS. Use `BLOCKED_EXTERNAL` only for a genuine external condition such as the live Duolingo site/account state preventing a safe visible-DOM sample.

## Evidence header

Record:

```text
BASE_SHA=
RC_SHA=
RC_TREE=
MERGE_BASE=
AHEAD_BEHIND=
CHANGED_FILES=
NODE_VERSION=
NPM_VERSION=
RC_VERSION=
```

## Gate 1 — reproducible package

From the exact candidate:

```bash
node --version
npm --version
npm ci
npm run check:package-reproducibility
npm run check:deterministic-zip-utf8
npm run package:store
```

Also reproduce the independent-build CI gate using the pinned toolchain and record:

```text
BUILD_A_SHA256=
BUILD_B_SHA256=
BUILD_C_SHA256=
PACKAGE_SIZE=
PACKAGE_FILES=
REPRODUCIBLE=PASS/FAIL
UTF8_ZIP=PASS/FAIL
```

All three accepted package hashes must match. `BUILD_C_SHA256` is the SHA-256 of the exact ZIP retained for later release/submission.

## Gate 2 — actual ZIP inspection

Inspect the exact candidate ZIP, not only `dist/`.

Require:

- Manifest V3;
- package/manifest version match the intended RC version;
- permissions exactly as expected;
- required host permissions limited to localhost AnkiConnect;
- Duolingo origins remain optional;
- no source maps;
- no `.ts` / `.tsx`;
- no test fixtures or `COLLECTOR_E2E` hooks;
- no synthetic canonical-assistance provider fixtures;
- no React, ReactDOM, or Scheduler development runtime;
- valid CRCs;
- UTF-8/EFS filename flag;
- deterministic timestamps and file modes.

Record:

```text
PACKAGE_INSPECTION=PASS/FAIL
PRODUCTION_RUNTIME=PASS/FAIL
NO_E2E_FIXTURES=PASS/FAIL
PERMISSIONS=PASS/FAIL
ZIP_SHA256=
```

The exact accepted ZIP/checksum is the artifact that must later be recreated by the GitHub Release workflow and submitted to the Chrome Web Store.

## Gate 3 — clean onboarding

With a clean disposable Chromium profile:

```text
install actual production build
-> first-run onboarding
-> skip/finish
-> reopen introduction from Settings
```

Require:

- skip/finish persistence;
- introduction can be reopened;
- no corpus mutation;
- no export-profile reset;
- no hidden network requirement.

Record `CLEAN_ONBOARDING=PASS/FAIL`.

## Gate 4 — real Anki profile setup

Use real Anki Desktop + AnkiConnect.

Configure at least one mapped existing user-owned note type and exercise multiple language routes covering:

- Hebrew;
- Serbian.

Spot-check Spanish routing/profile behavior where appropriate without unnecessary destructive setup.

Verify live:

- deck IDs;
- model IDs;
- field mapping;
- profile revalidation;
- unmapped fields preserved;
- templates/CSS unchanged.

Record hashes or schema/template evidence rather than publishing real card contents.

Record `REAL_ANKI_PROFILE_SETUP=PASS/FAIL`.

## Gate 5 — visible capture to real Anki

Using synthetic visible-page language material:

```text
select visible text
-> Collect
-> Inbox
-> review
-> explicit Ready
-> Export preview
-> real Anki export
```

Verify:

- correct profile;
- correct deck;
- correct note type;
- correct mapped fields;
- exactly one Anki note;
- local binding persisted.

Record `VISIBLE_CAPTURE_TO_ANKI=PASS/FAIL`.

## Gate 6 — repeat export idempotency

Export the same Ready identity again.

Require:

- same Anki note ID;
- no duplicate note;
- same Collector identity.

Record `REPEAT_EXPORT_IDEMPOTENT=PASS/FAIL`.

## Gate 7 — stronger evidence, same note

Add stronger study evidence to the same lexical unit.

Require:

- Ready returns to Inbox when effective approved study content changes;
- learning-value recommendation / study proposal updates correctly;
- explicit reapproval is required;
- subsequent export updates the same Anki note;
- no duplicate Anki identity.

Record `STRONGER_EVIDENCE_SAME_NOTE=PASS/FAIL`.

## Gate 8 — deleted-note recovery

Delete the disposable exported note directly in Anki, then export again.

Require:

- stale stored note detected;
- identity lookup/recovery logic runs;
- one replacement/reconciled note remains;
- local binding updated coherently;
- no duplicate surviving notes.

Record `DELETED_NOTE_RECOVERY=PASS/FAIL`.

## Gate 9 — real Duolingo visible-DOM sample

If a safe live Duolingo lesson/review state is available:

```text
grant optional permission
-> start explicit visible-material capture
-> stage several non-private examples
-> edit/select candidate
-> import selected only
```

Verify:

- unselected candidates remain Staged;
- selected material enters Inbox;
- selected material is not Ready;
- no direct Anki write;
- no private API or network interception.

If the current live site/account state prevents a safe sample, record the exact limitation as:

```text
REAL_DUOLINGO_VISIBLE_DOM=BLOCKED_EXTERNAL
```

Do not manufacture evidence.

## Gate 10 — staged reconstruction

While Staged state exists, restart/reload the extension or service-worker context.

Verify:

- surviving candidate IDs preserved;
- consumed candidates do not resurrect;
- high-water identity preserved;
- reclassification remains correct.

Record `STAGED_RECONSTRUCTION=PASS/FAIL`.

## Gate 11 — backup/restore

Create a backup v4 from controlled RC state and restore into a controlled clean/alternate state as appropriate.

Verify preservation of:

- lexical IDs;
- occurrence IDs;
- separate same-canonical identities;
- review state;
- learner notes;
- settings/routes/profiles;
- export bindings.

Also verify the documented transient-state boundary.

Exercise the ACCP-024 committed-success case where practical:

```text
post-commit refresh failure
-> restored data/settings remain durable
-> reload recovers
```

Do not rerun destructive restore unnecessarily.

Record `BACKUP_RESTORE=PASS/FAIL`.

## Gate 12 — Anki offline / retry

Stop Anki and attempt export.

The user-visible recovery must clearly communicate:

- local data is safe;
- open Anki Desktop;
- ensure AnkiConnect is available;
- Retry.

Restart Anki and complete export without rebuilding configuration.

Record `ANKI_OFFLINE_RETRY=PASS/FAIL`.

## Gate 13 — user-owned model safety

After all real-Anki operations, compare the mapped user-owned note type with the pre-run evidence.

Require unchanged:

- field schema;
- templates;
- CSS.

Unmapped fields must remain untouched.

Record `USER_MODEL_SCHEMA_UNCHANGED=PASS/FAIL`.

## Automated repository gates

For the exact candidate record:

```text
CHECK=PASS/FAIL
TYPECHECK=PASS/FAIL
UNIT_TESTS=
CHROMIUM_E2E=PASS/FAIL
AXE_ACCESSIBILITY=PASS/FAIL
PRODUCTION_SMOKES=PASS/FAIL
STORE_PACKAGE=PASS/FAIL
GITGUARDIAN=PASS/FAIL
```

If GitGuardian is not part of the repository CI, record the actual available security/secret-scan evidence rather than inventing a PASS.

## Acceptance decision

The release candidate is accepted only when every mandatory gate that is required for the candidate has real evidence.

```text
BLOCKING_FINDINGS=NONE/<list>
READY_FOR_INDEPENDENT_REVIEW=YES/NO
```

Do not tag, create a GitHub Release, submit to Chrome Web Store, merge the PR, or close issue #80 from this acceptance procedure.
