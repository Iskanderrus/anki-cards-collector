# ADR-0013 — Optional Qanbee Linguist connector preserves the local-first baseline

- **Status:** Accepted
- **Date:** 2026-09-29
- **Phase:** Post-Phase-1 / Phase 2 integration boundary

## Context

Phase 1 establishes Anki Cards Collector as a public, local-first browser extension whose normal workflow does not require an application server, account system or subscription.

Qanbee Linguist is being admitted as a separate commercial language-learning product. A future optional connector could let a Collector user send explicitly selected/approved learning material into Linguist for adaptive learning.

The integration must not retroactively turn Collector into a thin client for a paid backend or weaken its existing privacy promise.

## Decision

Collector may implement a future **optional Qanbee Linguist connector** only under these invariants:

1. Collector remains fully useful without Qanbee Linguist.
2. A Qanbee account is not required for normal Collector capture, review, backup or Anki export.
3. Remote transfer is explicit opt-in and user-visible.
4. The connector uses a versioned Linguist-owned ingestion contract.
5. Disconnecting Linguist restores the same local-only baseline without data loss to the Collector corpus.
6. Collector does not integrate directly with Qanbee Learning Intelligence (QLI).
7. Collector does not become a telemetry source merely because a Linguist connector exists.

## Allowed integration surface

A future connector may support explicitly authorized operations such as:

- authenticate/connect a Linguist account;
- send a user-selected or explicitly approved lexical item/evidence bundle;
- send stable Collector-side identity required for idempotent re-send/update semantics;
- receive a bounded acknowledgement/result needed to show transfer state;
- open the corresponding Linguist learning surface.

The exact payload must be frozen by the Linguist ingestion contract before implementation.

## Data minimization

The connector must not upload the whole local corpus by default.

Fields such as source URL, surrounding context, learner notes or historical occurrences may be transferred only when:

- the contract explicitly admits them;
- the UI makes the transfer understandable;
- existing Collector retention/privacy settings are respected;
- the user has explicitly authorized the applicable operation.

Collector must not send browser history, cookies, credentials, unrelated local storage or hidden page data.

## Local authority

Collector IndexedDB remains authoritative for Collector-local corpus/review/export state.

Linguist owns whatever server-side learner state it creates from an accepted transfer.

A successful transfer does not make Linguist authoritative for the Collector corpus, and a Linguist-side mutation must not silently rewrite local lexical identity or Ready/Archived workflow state.

## Failure/degraded path

Linguist unavailability, authentication failure, quota/subscription state or connector errors must not block:

- local capture;
- review;
- local backup/restore;
- TSV export;
- AnkiConnect discovery/export/recovery.

Connector retry must be explicit and idempotent.

## Release boundary

This ADR does **not** modify the ACCP-025 Phase 1 release gate.

Collector v0.1.0 must reach the real Chrome Web Store install path independently of Linguist.

Implementation starts only after:

- ACCP-025 is complete;
- the Linguist owning repository exists;
- the v1 ingestion contract is versioned and reviewed;
- authentication/privacy UX is specified.

## Alternatives considered

### Make Linguist the default backend for Collector

Rejected because it destroys the Phase 1 local-first product boundary.

### Bulk-sync the entire corpus automatically after sign-in

Rejected as the default because it is unnecessarily broad and changes the privacy expectation.

### Send Collector data directly to QLI

Rejected. Individual learner/product state belongs to Linguist; QLI receives only governed aggregate-eligible signals through the Linguist/QLI boundary.

### Keep products permanently disconnected

Rejected as an architectural rule because an optional connector can create substantial learning value without sacrificing Collector independence.

## Consequences

- Collector remains a credible standalone OSS tool.
- Qanbee Linguist can become an optional premium destination for selected evidence.
- The commercial product can evolve without forcing Collector users into an account.
- Privacy and failure semantics are testable at the connector boundary.

## Review triggers

Revisit this decision if:

- Chrome Web Store policy materially changes remote-account/data disclosure requirements;
- the Linguist ingestion contract requires data incompatible with Collector's privacy promise;
- users demonstrate a strong need for explicit bulk sync that justifies a separately reviewed mode;
- connector complexity begins to compromise the standalone Collector workflow.
