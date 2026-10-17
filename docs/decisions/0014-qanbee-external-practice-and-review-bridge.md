# ADR-0014 — Optional Qanbee external-practice and bound-review bridge

- **Status:** Accepted
- **Date:** 2026-10-17
- **Extends:** ADR-0013
- **Family spec:** `Iskanderrus/Qanbee/docs/superpowers/specs/2026-10-17-alex-learning-anki-linguist-integration-design.md`

## Context

ADR-0013 already admits an optional, explicit Collector -> Linguist connector while preserving Collector's standalone local-first baseline.

The fuller Qanbee learning architecture also benefits from the opposite bounded direction: Linguist may nominate a high-value item for external spaced retrieval, Collector may materialize it safely into the user's existing Anki setup, and review observations for that explicitly bound item may later return to Linguist as learner evidence.

This must not become automatic whole-deck synchronization or transfer Anki/Collector authority into Qanbee.

## Decision

Collector may support an optional **external-practice bridge** under these invariants:

1. Collector remains fully useful without Qanbee.
2. Existing local capture/review/backup/Anki export behavior remains unchanged when the bridge is absent or disconnected.
3. Linguist-originated practice offers are explicit, versioned and account-scoped.
4. Collector remains authoritative for local corpus state and Anki routing/materialization.
5. Anki deck/model/note/card identities remain foreign local identities; Linguist receives only bounded binding references it needs.
6. Review return is limited by default to cards explicitly bound through the connector, not the user's entire Anki collection.
7. Review observations return only to Linguist. Collector never publishes learner review data directly to QLI.
8. Disconnect is explicit and must not delete local Anki cards or Collector corpus data by default.
9. Transfer/retry semantics are idempotent.

## Allowed surfaces

### Linguist -> Collector

A bounded `ExternalPracticeOffer` may request materialization of one explicitly selected item/chunk, including only contract-admitted language/prompt/content/provenance fields.

### Collector -> Linguist binding acknowledgement

After successful materialization, Collector may return a bounded binding projection containing stable Collector/Anki identity references required for idempotency and future review attribution.

### Bound Anki review -> Linguist

For explicitly bound cards, Collector may publish a normalized review observation containing only admitted fields such as review time, answer/rating class, response latency or interval metadata where available and useful.

No raw full-collection revlog upload is admitted by default.

## Scheduling authority

When a binding declares `scheduler_authority = ANKI`, Anki owns due dates/intervals for the bound card. Collector must not invent a second schedule, and Linguist must not infer local Anki scheduling state beyond the admitted projection.

## Privacy and minimization

The bridge must not send by default:

- unrelated decks/cards;
- complete Anki collection history;
- browser history/cookies/credentials;
- unrelated Collector occurrences/notes;
- hidden local storage;
- QLI-targeted telemetry.

Continuous bounded sync for explicitly bound cards may be admitted later only with clear connector UX and scope.

## Failure / degraded mode

Qanbee unavailability, auth failure, subscription state, stale contract or transfer error must not block local Collector/Anki use.

A failed review upload must not rewrite the Anki card, Collector lexical identity, Ready/Archived state, or local review history.

## Relationship to ACCP-026 / ACCP-027

- **ACCP-026** remains the first Phase-2 Collector -> Linguist connector and owns the shared connection/auth/remote-transport boundary while preserving its original explicit one-item ingestion scope.
- **ACCP-027 / issue #85** owns Linguist-originated external-practice materialization, binding acknowledgement and bound-review return.
- ACCP-027 reuses the ACCP-026 transport and existing Anki discovery/routing/export machinery; it must not create a parallel connector or raw note-routing implementation.

## Rejected alternatives

- automatic whole-deck cloud sync after sign-in;
- direct Collector -> QLI publication;
- making Qanbee authoritative for user-owned Anki decks/models;
- deleting local Anki material when Qanbee disconnects;
- treating review success as canonical Linguist mastery.

## Review triggers

Revisit if AnkiConnect review APIs cannot support a bounded reliable projection, if privacy requirements make review return disproportionate, or if user demand justifies a separately reviewed explicit broader sync mode.
