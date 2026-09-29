# ACCP-026 — Optional Qanbee Linguist connector

- **Status:** Planned Phase 2 — BLOCKED until ACCP-025 and Linguist contract v1
- **ADR:** 0013
- **Date:** 2026-09-29

## Goal

Add an optional, explicit Collector -> Qanbee Linguist integration without changing the standalone local-first Collector baseline.

## Hard prerequisites

- ACCP-025 complete, including real Chrome Web Store install path;
- `Iskanderrus/qanbee-linguist` exists;
- Linguist ingestion contract v1 is versioned and reviewed;
- authentication/account-connect UX is defined;
- privacy/data-transfer copy is defined;
- local-only degraded path remains complete.

## Minimum vertical slice

1. **Connect**
   - explicit user action;
   - secure account/auth flow defined by Linguist;
   - no background corpus upload.

2. **Send one approved item**
   - user explicitly chooses/sends;
   - payload validated against ingestion v1;
   - existing Collector source-retention settings respected;
   - idempotency identity included where contract requires it.

3. **Transfer state**
   - bounded local transfer status;
   - retryable failure;
   - no mutation of Ready/Archived state merely because transfer succeeds/fails.

4. **Open Linguist**
   - optional deep link to the corresponding learning surface.

5. **Disconnect**
   - removes connector/session state;
   - local Collector corpus and Anki workflow continue unchanged.

## Tests

Required coverage includes:

- connector absent => existing Collector behavior unchanged;
- auth unavailable/fails => local workflow unaffected;
- explicit-send only;
- no implicit whole-corpus upload;
- prohibited/unadmitted fields excluded;
- idempotent re-send/retry;
- disconnect preserves local data;
- source-retention modes respected;
- browser permission/privacy regression coverage;
- production build/store checks remain green.

## Non-goals for ACCP-026

- automatic full-corpus cloud sync;
- replacing Anki export;
- QLI integration;
- server-side ownership of Collector workflow state;
- telemetry/analytics unrelated to an explicit Linguist transfer;
- mandatory Qanbee account.

## Acceptance

```text
ACCP025_RELEASE_COMPLETE=YES
LINGUIST_INGESTION_V1=FROZEN
CONNECT_EXPLICIT=PASS
SEND_ONE_ITEM_EXPLICIT=PASS
NO_BACKGROUND_BULK_UPLOAD=PASS
LOCAL_ONLY_DEGRADED_PATH=PASS
IDEMPOTENT_RETRY=PASS
DISCONNECT_PRESERVES_LOCAL_CORPUS=PASS
ANKI_WORKFLOW_NON_REGRESSION=PASS
STORE_BUILD_NON_REGRESSION=PASS
```
