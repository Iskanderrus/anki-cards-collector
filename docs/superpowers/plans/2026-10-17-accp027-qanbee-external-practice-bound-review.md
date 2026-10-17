# ACCP-027 Qanbee External Practice + Bound-Review Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the optional ACCP-026 Qanbee connector so Collector can safely materialize explicitly selected Linguist external-practice offers into the user's existing Anki setup and return bounded review observations only for those bound cards.

**Architecture:** ACCP-026 owns the shared connection/auth/remote-transport seam. ACCP-027 adds a local-first `QanbeeExternalPracticeBinding` projection keyed to one versioned Linguist offer and the exact Collector/Anki identities produced by the existing routing/export machinery. Review return queries only explicitly bound card IDs, normalizes admitted review fields, and sends them to Linguist through the ACCP-026 transport; Collector never becomes a learner/mastery authority and never publishes directly to QLI.

**Tech Stack:** TypeScript 5.8, React 19 extension UI, Dexie 4/IndexedDB, existing AnkiConnect client/export/routing modules, Vitest 5, Playwright/Chromium E2E, Node 22.23.3 / npm 11.6.0.

**Spec:** Qanbee `docs/superpowers/specs/2026-10-17-alex-learning-anki-linguist-integration-design.md` + Collector ADR-0014.

## Global Constraints

- Issue: `#85` — `ACCP-027 — Qanbee external-practice + bound-review bridge`.
- ACCP-025 remains the Phase-1 release gate; ACCP-027 cannot delay the standalone release.
- ACCP-026 must establish the optional connector/auth/transport contract first.
- Collector remains fully useful without Qanbee; local capture/review/backup/Anki export stay unchanged when disconnected.
- `scheduler_authority=ANKI` means Anki owns due interval/date for the bound card; Collector does not invent a scheduler.
- No whole-deck/revlog sync by default; only explicitly bound card IDs are eligible for review return.
- No direct Collector -> QLI dependency or telemetry path.
- Qanbee/Linguist never becomes authoritative for user-owned Anki deck/model/note/card identity.
- Remote failures never mutate local lexical identity, Ready/Archived state, Anki review history or existing cards.
- All offer/binding/review transfer operations are versioned and idempotent.

## Review Focus

- Retrying the same Linguist offer must not create a second Collector item or duplicate Anki note/card.
- Existing Anki cards selected/mapped by the normal export path must preserve note/card/deck/model identity.
- Deleted/missing/stale bound card IDs must yield an explicit degraded observation state, not an unrelated-card lookup.
- Review pagination/cursors/retries must not resend the same review as a new observation without stable idempotency identity.
- Disconnect/reconnect must retain local cards/bindings as local history while stopping remote review publication until explicitly reconnected.

---

### Task 1: Freeze ACCP-027 connector contracts

**Files:**
- Create: `src/integrations/qanbee/external-practice-contract.ts`
- Create: `src/integrations/qanbee/external-practice-contract.test.ts`
- Modify: the ACCP-026 Qanbee transport contract module created during ACCP-026.

**Interfaces:**
- `ExternalPracticeOfferV1`
- `ExternalPracticeBindingAckV1`
- `ExternalReviewObservationV1`
- Runtime validators: `parseExternalPracticeOffer(input: unknown)`, `parseExternalReviewObservation(input: unknown)`.

- [ ] **Step 1: Write failing contract tests** for valid payloads plus unknown version, unrelated learner/account scope, forbidden whole-deck/revlog fields and missing exact offer/binding identity.
- [ ] **Step 2: Run targeted tests** with `npm test -- src/integrations/qanbee/external-practice-contract.test.ts`; expected FAIL until module exists.
- [ ] **Step 3: Implement strict versioned types/validators** following ACCP-026 transport conventions.
- [ ] **Step 4: Re-run tests** and verify PASS.
- [ ] **Step 5: Commit.**

### Task 2: Persist local external-practice bindings without changing corpus authority

**Files:**
- Create: `src/integrations/qanbee/external-practice-binding.ts`
- Create: `src/integrations/qanbee/external-practice-binding.test.ts`
- Modify: `src/storage/database.ts`
- Modify: `src/storage/database.migration.test.ts`
- Modify: `src/storage/repository.ts`
- Modify: `src/storage/repository.test.ts`

**Interfaces:**
- `QanbeeExternalPracticeBinding`: local binding ID, remote offer ID/version, optional Collector lexical/item ID, exact Anki deck/note/card IDs, contract version, created/updated timestamps, remote sync cursor/status; no mastery field.
- Repository methods are additive and live alongside existing local corpus truth rather than replacing it.

- [ ] **Step 1: Write failing migration/repository tests** for add/read/idempotent-upsert binding records and old-database migration.
- [ ] **Step 2: Add tests** proving binding creation does not mutate Ready/Archived/canonical lexical state.
- [ ] **Step 3: Implement the minimal Dexie table/migration/repository methods.**
- [ ] **Step 4: Run storage migration/repository tests** and verify PASS.
- [ ] **Step 5: Commit.**

### Task 3: Materialize one Linguist offer through the existing Anki routing/export path

**Files:**
- Create: `src/integrations/qanbee/materialize-external-practice.ts`
- Create: `src/integrations/qanbee/materialize-external-practice.test.ts`
- Modify/use: `src/anki/export.ts`
- Modify/use: existing mapping/routing/batch modules under `src/anki/` only where an additive external-offer entry point is required.

**Interfaces:**
- `materializeExternalPracticeOffer(offer, collectorState, ankiCatalog) -> ExternalPracticeBindingAckV1`
- Must call the existing user-owned model/deck routing and idempotent export/recovery machinery rather than constructing raw Anki notes independently.

- [ ] **Step 1: Write failing tests** for new item materialization, existing matching item/card reuse, repeated-offer retry and unsupported mapping/profile.
- [ ] **Step 2: Add regression tests** proving existing export behavior/hash/identity is unchanged when no Qanbee offer exists.
- [ ] **Step 3: Implement the smallest adapter into the normal routing/export path.**
- [ ] **Step 4: Run new tests plus existing `src/anki/*` routing/export tests** and verify PASS.
- [ ] **Step 5: Commit.**

### Task 4: Return binding acknowledgement through ACCP-026 transport

**Files:**
- Modify/create ACCP-026 transport/service module.
- Create: `src/integrations/qanbee/binding-sync.test.ts`

**Interfaces:**
- `publishBindingAck(binding) -> Promise<RemoteAck>` with stable idempotency key based on remote offer/binding identity.

- [ ] **Step 1: Write failing tests** for success, network/auth failure, replay, stale contract and retry after restart.
- [ ] **Step 2: Implement bounded status/retry state** without changing local item/Anki success when remote acknowledgement fails.
- [ ] **Step 3: Verify local workflow remains usable offline/disconnected.**
- [ ] **Step 4: Run targeted tests** and verify PASS.
- [ ] **Step 5: Commit.**

### Task 5: Read review observations only for explicitly bound Anki card IDs

**Files:**
- Create: `src/anki/bound-review-observations.ts`
- Create: `src/anki/bound-review-observations.test.ts`
- Modify: `src/anki/client.ts` only to expose the minimal AnkiConnect read operation required by admitted review fields.
- Extend: `src/anki/client.test.ts`.

**Interfaces:**
- `readBoundReviewObservations(cardIds: number[], cursor) -> NormalizedBoundReviewPage`
- Input card IDs must come from active/historical `QanbeeExternalPracticeBinding` records only.

- [ ] **Step 1: Write failing tests** for one bound card, multiple bound cards, unbound-card rejection, deleted card, duplicate/reordered reviews and empty result.
- [ ] **Step 2: Add Anki client contract tests** for the exact AnkiConnect operation/result fields used.
- [ ] **Step 3: Implement minimal read/normalization logic**; do not expose general full-deck history sync.
- [ ] **Step 4: Run Anki client/review tests** and verify PASS.
- [ ] **Step 5: Commit.**

### Task 6: Publish idempotent normalized review observations to Linguist

**Files:**
- Create: `src/integrations/qanbee/review-sync.ts`
- Create: `src/integrations/qanbee/review-sync.test.ts`
- Modify/use ACCP-026 transport service.

**Interfaces:**
- `syncBoundReviews(binding, cursor) -> Promise<ReviewSyncResult>`
- Stable review observation identity must prevent replay from becoming duplicate learner evidence downstream.

- [ ] **Step 1: Write failing tests** for successful page sync, partial network failure, retry, cursor advancement only after acknowledged delivery and disconnect pause.
- [ ] **Step 2: Implement bounded sync/retry/cursor state.**
- [ ] **Step 3: Assert payload excludes unrelated Collector corpus/browser/deck data.**
- [ ] **Step 4: Run tests** and verify PASS.
- [ ] **Step 5: Commit.**

### Task 7: Add explicit connector UI/status controls

**Files:**
- Modify ACCP-026 Qanbee connector settings/UI surface created by ACCP-026.
- Modify: `src/settings.ts` / sidepanel integration only where existing settings architecture requires it.
- Extend colocated tests and Chromium E2E fixture.

**Interfaces:**
- Show connected/disconnected state, pending/failed external-practice bindings, bounded review-sync status, explicit retry and disconnect behavior.
- No silent background whole-corpus/deck sync toggle.

- [ ] **Step 1: Write failing UI tests** for offer received/materialized, binding ack failure, review sync paused, reconnect and disconnect.
- [ ] **Step 2: Implement minimal user-visible states/actions** consistent with local-first privacy copy.
- [ ] **Step 3: Run component/E2E accessibility checks.**
- [ ] **Step 4: Verify normal non-Qanbee UI/workflow is unchanged when connector is absent.**
- [ ] **Step 5: Commit.**

### Task 8: Backup/restore and privacy regression

**Files:**
- Modify backup/restore code only if external-practice binding state is admitted to the local backup schema.
- Extend storage/backup/privacy tests.

- [ ] **Step 1: Decide/document whether binding metadata is included in local backup; test the chosen versioned behavior.**
- [ ] **Step 2: Prove restore cannot mutate user-owned Anki cards merely from restored remote binding metadata.**
- [ ] **Step 3: Prove disconnect/removal of remote auth state leaves local corpus/cards intact.**
- [ ] **Step 4: Run backup/privacy regression tests.**
- [ ] **Step 5: Commit.**

### Task 9: End-to-end acceptance and real-Anki boundary

- [ ] Run `npm run check`.
- [ ] Run relevant Chromium E2E/accessibility coverage.
- [ ] Perform bounded real-Anki acceptance: one explicit offer -> existing routing/materialization -> exact binding IDs -> one bound review projection -> mocked/staging Linguist acknowledgement.
- [ ] Verify retry does not duplicate note/card/binding/review observation.
- [ ] Verify Collector remains fully usable with Qanbee disconnected/unavailable.
- [ ] Record exact-head evidence for independent review.

## Acceptance

```text
ISSUE_85_MINTED=PASS
ACCP025_RELEASE_NOT_BLOCKED=PASS
ACCP026_TRANSPORT_REUSED=PASS
EXPLICIT_OFFER_ONLY=PASS
EXISTING_ANKI_ROUTING_REUSED=PASS
ANKI_IDENTITY_PRESERVED=PASS
IDEMPOTENT_MATERIALIZATION=PASS
BOUND_REVIEW_ONLY=PASS
NO_WHOLE_DECK_REVLOG_SYNC=PASS
NO_DIRECT_QLI=PASS
REMOTE_FAILURE_LOCAL_NON_REGRESSION=PASS
DISCONNECT_PRESERVES_LOCAL_DATA=PASS
REAL_ANKI_ACCEPTANCE=PASS
```
