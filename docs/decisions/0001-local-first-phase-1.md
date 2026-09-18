# ADR 0001: Keep Phase 1 local-first

**Status:** Accepted

## Context

The first useful workflow is single-user and single-browser: capture language, review it, and export it to a local Anki installation.

A backend would introduce accounts, deployment, authentication, remote data retention, sync conflict semantics, and operational work before any of those solve a Phase 1 user problem.

## Decision

Phase 1 has no application backend.

The extension stores its corpus in IndexedDB and settings in browser-local storage. Direct Anki export talks only to AnkiConnect on localhost.

## Consequences

Good:

- the privacy story is easy to inspect;
- the extension works offline apart from page access itself;
- there is no service to deploy or keep alive;
- failure of Anki does not threaten captured data.

Costs:

- no cross-device sync;
- browser data loss must be handled through backup/restore;
- server-side enrichment is out of scope.

A backend can be introduced later when a concrete sync, shared-data, or server-processing requirement justifies it.
